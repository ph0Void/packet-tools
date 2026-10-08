import { redirect } from "next/navigation";
import { getSessionUser } from "@/action/SecureAction";
import { getDevices } from "@/service/DeviceProviderService";
import TableDeviceWrapper from "@/component/device/TableDeviceWrapper";

export const metadata = {
  title: "Packet Tools - Dispositivos",
  description: "Gestión de dispositivos de red registrados",
};

export default async function DevicePage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth");

  const result = await getDevices();
  const devices = result.success && result.data ? result.data : [];
  const canManage = user.role === "ADMIN" || user.role === "STAFF";

  return (
    <div className="space-y-6 text-foreground p-1">
      <TableDeviceWrapper devices={devices} canManage={canManage} />
    </div>
  );
}
