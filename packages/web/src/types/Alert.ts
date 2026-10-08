export interface AlertTypes {
    id: string;
    title: string;
    description: string;
    severity: string;
    resolved: boolean;
    createAt: Date;
    topologyId: string;
}
