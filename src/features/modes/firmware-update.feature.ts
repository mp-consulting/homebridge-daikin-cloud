/**
 * Firmware Update Feature
 *
 * Exposes gateway firmware updates as a HomeKit switch, replacing the need to
 * install them from the Onecta app. The switch is ON while an update is
 * installing; turning it ON triggers installation of a staged update via the
 * dedicated firmware endpoint (see DaikinApi.triggerFirmwareUpdate). Firmware
 * characteristics live on the *gateway* management point, not the climate
 * control one the other features use.
 */

import type { CharacteristicValue } from 'homebridge';
import { BaseFeature } from '../base-feature';
import type { FeatureConfigKey } from '../../config/config-manager';

const IN_PROGRESS = 'in-progress';
const SWITCH_REVERT_DELAY_MS = 1000;

export class FirmwareUpdateFeature extends BaseFeature {
  private announcedVersion?: string;
  private announcedStatus?: string;

  get featureName(): string {
    return 'Firmware Update';
  }

  get serviceSubtype(): string {
    return 'firmware_update';
  }

  /**
   * A standalone toggle: unlike other features it never inherits the legacy
   * `showExtraFeatures` catch-all (see FEATURE_CONFIG_KEYS). A switch that
   * installs firmware should only appear when explicitly enabled, so an
   * all-switches scene can't trigger it unnoticed.
   */
  get configKey(): FeatureConfigKey {
    return 'showFirmwareUpdateSwitch';
  }

  isSupported(): boolean {
    const gatewayId = this.gatewayId;
    return gatewayId !== undefined
      && this.device.isFirmwareUpdateSupported(gatewayId);
  }

  async handleGet(): Promise<CharacteristicValue> {
    return this.updateStatus === IN_PROGRESS;
  }

  async handleSet(value: CharacteristicValue): Promise<void> {
    if (!value) {
      return this.handleTurnOff();
    }
    if (this.updateStatus === IN_PROGRESS) {
      this.log.info(`[${this.name}] Firmware update already in progress`);
      return;
    }
    await this.installStagedUpdate();
  }

  /**
   * Push status to HomeKit and announce availability / outcome transitions.
   */
  refresh(): void {
    this.announceAvailability();
    this.announceOutcome();
    super.refresh();
  }

  private get gatewayId(): string | undefined {
    return this.device.getManagementPointIdByType('gateway');
  }

  private get updateStatus(): string | undefined {
    const gatewayId = this.gatewayId;
    return gatewayId ? this.device.getFirmwareUpdateStatus(gatewayId) : undefined;
  }

  private async installStagedUpdate(): Promise<void> {
    const gatewayId = this.gatewayId;
    const info = gatewayId ? this.device.getFirmwareUpdateInfo(gatewayId) : undefined;
    if (!gatewayId || !info) {
      this.log.info(`[${this.name}] Firmware is up to date — no update staged by Daikin`);
      return this.revertSwitchTo(false);
    }
    await this.triggerInstall(gatewayId, info.version);
  }

  private async triggerInstall(gatewayId: string, version?: string): Promise<void> {
    // No forced refresh: the update runs for minutes and the poll picks up its status.
    const info = await this.write(
      'firmware update',
      () => this.device.triggerFirmwareUpdate(gatewayId),
      false,
    );
    this.log.info(`[${this.name}] Installing firmware update ${info.version ?? version ?? ''} `
      + '— the unit will be unavailable until it finishes');
  }

  private handleTurnOff(): void {
    if (this.updateStatus === IN_PROGRESS) {
      this.log.info(`[${this.name}] A running firmware update cannot be cancelled`);
      this.revertSwitchTo(true);
    }
  }

  /**
   * HomeKit assumes a set succeeded unless the handler throws; when the set is
   * merely a no-op (nothing to install / can't cancel), push the real state
   * back shortly after so the switch doesn't stick in the wrong position.
   */
  private revertSwitchTo(value: boolean): void {
    setTimeout(() => {
      this.switchService?.getCharacteristic(this.platform.Characteristic.On).updateValue(value);
    }, SWITCH_REVERT_DELAY_MS);
  }

  private announceAvailability(): void {
    const gatewayId = this.gatewayId;
    const info = gatewayId ? this.device.getFirmwareUpdateInfo(gatewayId) : undefined;
    if (info && info.version !== this.announcedVersion) {
      this.announcedVersion = info.version;
      this.log.info(`[${this.name}] Firmware update available: ${info.version ?? 'unknown version'}`
        + `${info.description ? ` (${info.description})` : ''} — turn on the "Firmware Update" switch to install`);
    }
  }

  private announceOutcome(): void {
    const status = this.updateStatus;
    if (status !== this.announcedStatus) {
      this.announcedStatus = status;
      if (status === 'succeeded' || status === 'failed') {
        this.log.info(`[${this.name}] Firmware update ${status}`);
      }
    }
  }
}
