/**
 * Consolidated Daikin enums used across the plugin.
 * These enums represent the values used by the Daikin Cloud API.
 */

export enum DaikinOnOffModes {
    ON = 'on',
    OFF = 'off',
}

export enum DaikinOperationModes {
    FAN_ONLY = 'fanOnly',
    HEATING = 'heating',
    COOLING = 'cooling',
    AUTO = 'auto',
    DRY = 'dry',
}

export enum DaikinFanSpeedModes {
    AUTO = 'auto',
    QUIET = 'quiet',
    FIXED = 'fixed',
}

export enum DaikinFanDirectionHorizontalModes {
    STOP = 'stop',
    SWING = 'swing',
}

export enum DaikinFanDirectionVerticalModes {
    STOP = 'stop',
    SWING = 'swing',
    WIND_NICE = 'windNice',
}

export enum DaikinPowerfulModes {
    ON = 'on',
    OFF = 'off',
}

export enum DaikinEconoModes {
    ON = 'on',
    OFF = 'off',
}

export enum DaikinStreamerModes {
    ON = 'on',
    OFF = 'off',
}

export enum DaikinOutdoorSilentModes {
    ON = 'on',
    OFF = 'off',
}

export enum DaikinControlModes {
    ROOM_TEMPERATURE = 'roomTemperature',
    LEAVING_WATER_TEMPERATURE = 'leavingWaterTemperature',
    EXTERNAL_ROOM_TEMPERATURE = 'externalRoomTemperature',
}

export enum DaikinSetpointModes {
    FIXED = 'fixed',
    WEATHER_DEPENDENT_HEATING_FIXED_COOLING = 'weatherDependentHeatingFixedCooling',
    WEATHER_DEPENDENT = 'weatherDependent',
}

export enum DaikinTemperatureControlSetpoints {
    ROOM_TEMPERATURE = 'roomTemperature',
    LEAVING_WATER_OFFSET = 'leavingWaterOffset',
    LEAVING_WATER_TEMPERATURE = 'leavingWaterTemperature',
}
