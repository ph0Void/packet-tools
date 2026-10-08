import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { Device, Link, Topology } from "@/types";

interface TopologyStore {
  devices: Device[];
  links: Link[];
  selectedDeviceId: string | null;
  setTopology: (topology: Topology) => void;
  setSelectedDeviceId: (id: string | null) => void;
  updateDeviceStatus: (deviceName: string, updates: Partial<Device>) => void;
  addDevice: (device: Device) => void;
  removeDevice: (deviceName: string) => void;
  addLink: (link: Link) => void;
  removeLink: (linkId: string) => void;
  clearStore: () => void;
}

export const useTopologyStore = create<TopologyStore>()(
  persist(
    (set) => ({
      devices: [],
      links: [],
      selectedDeviceId: null,

      setTopology: (topology) =>
        set({
          devices: topology.devices,
          links: topology.links,
        }),

      setSelectedDeviceId: (id) => set({ selectedDeviceId: id }),

      updateDeviceStatus: (deviceName, updates) =>
        set((state) => ({
          devices: state.devices.map((d) =>
            d.name === deviceName ? { ...d, ...updates } : d
          ),
        })),

      addDevice: (device) =>
        set((state) => {
          if (state.devices.some((d) => d.name === device.name)) return {};
          return { devices: [...state.devices, device] };
        }),

      removeDevice: (deviceName) =>
        set((state) => ({
          devices: state.devices.filter((d) => d.name !== deviceName),
          links: state.links.filter(
            (l) => l.sourceDevice !== deviceName && l.targetDevice !== deviceName
          ),
          selectedDeviceId:
            state.selectedDeviceId === deviceName ? null : state.selectedDeviceId,
        })),

      addLink: (link) =>
        set((state) => {
          if (state.links.some((l) => l.id === link.id)) return {};
          return { links: [...state.links, link] };
        }),

      removeLink: (linkId) =>
        set((state) => ({
          links: state.links.filter((l) => l.id !== linkId),
        })),

      clearStore: () =>
        set({
          devices: [],
          links: [],
          selectedDeviceId: null,
        }),
    }),
    {
      name: "cisco-topology-storage",
      storage: createJSONStorage(() => localStorage),

    }
  )
);
