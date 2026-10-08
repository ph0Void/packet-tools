import { Role } from "@/prisma/generated/enums";
import { resourceRouter } from "./ResourceRouter";
export default resourceRouter("topology", { roles: [Role.ADMIN, Role.STAFF], ownerField: "ownerId", scopeReads: false } as any);
