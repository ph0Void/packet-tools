import { Role } from "@/prisma/generated/enums";
import { resourceRouter } from "./ResourceRouter";
export default resourceRouter("deviceProviders", { roles: [Role.ADMIN] });
