import { AlertTypes } from "./Alert";

export interface TopologyType {
    id: string;
    name: string;
    description: string;

    createdAt: Date;

    alerts: AlertTypes[];
}
