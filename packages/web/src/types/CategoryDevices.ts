import { DeviceType } from ".";

export function getDeviceCategory(typeNum: number): DeviceType {
    if (typeNum === 0) return "router";
    if (typeNum === 1 || typeNum === 16) return "switch";
    if ([2, 3, 4, 5, 6].includes(typeNum)) return "cloud_hub";
    if ([7, 11, 30, 41, 44].includes(typeNum)) return "wireless";
    if ([8, 10, 18, 19, 20, 21, 22, 23, 34, 35].includes(typeNum)) return "pc";
    if ([9, 32, 40, 49].includes(typeNum)) return "server";
    if ([12, 24, 25].includes(typeNum)) return "voip";
    if ([13, 14].includes(typeNum)) return "infrastructure";
    if (typeNum === 27) return "security";
    if (typeNum === 31) return "infrastructure";
    if ([29, 36, 37].includes(typeNum)) return "iot";
    if (typeNum === 39) return "iot";
    if ([45, 46, 47].includes(typeNum)) return "infrastructure";
    if ([48, 50].includes(typeNum)) return "infrastructure";
    return "unknown";
}
