import { describe, it, expect } from 'vitest';
import { GatewayDeviceSchema, ManagementPointSchema } from '../../../src/api/daikin-schemas';
import { dx23Airco } from '../../fixtures/dx23-airco';
import { dx4Airco } from '../../fixtures/dx4-airco';

// Walk raw + parsed in parallel and collect every key Zod dropped. Mirrors
// scripts/check-schema-drift.ts so we catch new metadata stripping in CI.
function findStrippedKeys(raw: unknown, parsed: unknown, path = ''): string[] {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return [];
  }
  if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
    return path ? [path] : [];
  }
  if (Array.isArray(raw)) {
    if (!Array.isArray(parsed)) {
      return [];
    }
    return raw.flatMap((r, i) => findStrippedKeys(r, parsed[i], `${path}[${i}]`));
  }
  const out: string[] = [];
  for (const key of Object.keys(raw)) {
    const childPath = path ? `${path}.${key}` : key;
    if (!(key in (parsed as Record<string, unknown>))) {
      out.push(childPath);
    } else {
      out.push(...findStrippedKeys(
        (raw as Record<string, unknown>)[key],
        (parsed as Record<string, unknown>)[key],
        childPath,
      ));
    }
  }
  return out;
}

// Zod 4 strips unknown object keys by default. Several places in the runtime
// rely on metadata fields that Daikin returns on `fanSpeed.modes.*` and
// `fanSpeed.currentMode` — if the schema does not declare them they get
// silently dropped, the HomeKit slider keeps its 0-100 default range, and
// Daikin rejects the resulting writes with 400 INVALID_CHARACTERISTIC_VALUE.
describe('ManagementPointSchema — fanControl metadata survives parsing', () => {
  it('preserves minValue/maxValue/stepValue/settable on fanSpeed.modes.fixed (dx23)', () => {
    const climateControlRaw = dx23Airco.managementPoints.find(mp => mp.embeddedId === 'climateControl');
    expect(climateControlRaw).toBeDefined();

    const parsed = ManagementPointSchema.parse(climateControlRaw);
    const fixed = (parsed.fanControl as any).value.operationModes.cooling.fanSpeed.modes.fixed;

    expect(fixed).toMatchObject({
      value: expect.any(Number),
      minValue: expect.any(Number),
      maxValue: expect.any(Number),
      stepValue: expect.any(Number),
      settable: expect.any(Boolean),
    });
  });

  it('preserves currentMode.values so handleRotationSpeedSet can detect allowed modes (dx4)', () => {
    const climateControlRaw = dx4Airco.managementPoints.find(mp => mp.embeddedId === 'climateControl');
    expect(climateControlRaw).toBeDefined();

    const parsed = ManagementPointSchema.parse(climateControlRaw);
    const currentMode = (parsed.fanControl as any).value.operationModes.cooling.fanSpeed.currentMode;

    expect(Array.isArray(currentMode.values)).toBe(true);
    expect(currentMode.values.length).toBeGreaterThan(0);
  });
});

// Catch-all: any new Daikin metadata field added to a fixture must survive
// parsing. If this fails, wrap the offending nested z.object(...) with chr()
// (or add the field explicitly) in src/api/daikin-schemas.ts.
describe('GatewayDeviceSchema — no silent field stripping on real fixtures', () => {
  it.each([
    ['dx23-airco', dx23Airco],
    ['dx4-airco', dx4Airco],
  ])('fixture %s parses with zero stripped keys', (_label, fixture) => {
    const parsed = GatewayDeviceSchema.parse(fixture);
    const stripped = findStrippedKeys(fixture, parsed);
    expect(stripped).toEqual([]);
  });
});
