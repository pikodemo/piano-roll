// Web MIDI wrapper. Used for keyboard input — pressing a key on a connected
// MIDI controller plays a preview through the active voice's instrument.
//
// The Web MIDI API is gated on a permission prompt in some browsers. We don't
// re-prompt: if the user denies once, MIDI is simply unavailable until the
// page reloads.

export interface MIDIDeviceInfo {
  id: string;
  name: string;
  manufacturer?: string;
}

export type MIDIEventHandler = (e:
  | { type: "noteOn"; note: number; velocity: number }
  | { type: "noteOff"; note: number }
) => void;

let access: MIDIAccess | null = null;
let pending: Promise<MIDIAccess | null> | null = null;

export async function getMIDIAccess(): Promise<MIDIAccess | null> {
  if (typeof navigator === "undefined") return null;
  const req = (navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> }).requestMIDIAccess;
  if (!req) return null;
  if (access) return access;
  if (pending) return pending;
  pending = req.call(navigator).then((a) => { access = a; pending = null; return a; }).catch(() => { pending = null; return null; });
  return pending;
}

export function listInputs(): MIDIDeviceInfo[] {
  if (!access) return [];
  return Array.from(access.inputs.values()).map((i) => ({
    id: i.id,
    name: i.name ?? i.id,
    manufacturer: i.manufacturer ?? undefined,
  }));
}

// Subscribe to all current and future MIDI inputs. Returns an unsubscribe.
export function subscribe(handler: MIDIEventHandler): () => void {
  if (!access) return () => { /* nothing to unsubscribe */ };

  const cleanups = new Map<string, () => void>();

  function attach(input: MIDIInput) {
    const onMsg = (e: Event) => {
      const data = (e as MIDIMessageEvent).data;
      if (!data || data.length < 2) return;
      const status = data[0];
      const note = data[1];
      const velocity = data[2] ?? 0;
      const cmd = status & 0xf0;
      // Some controllers send note-on with velocity 0 instead of note-off.
      if (cmd === 0x90 && velocity > 0) {
        handler({ type: "noteOn", note, velocity: velocity / 127 });
      } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {
        handler({ type: "noteOff", note });
      }
    };
    input.addEventListener("midimessage", onMsg);
    cleanups.set(input.id, () => input.removeEventListener("midimessage", onMsg));
  }

  for (const input of access.inputs.values()) attach(input);

  // Re-attach as devices come and go.
  const onState = (e: Event) => {
    const port = (e as MIDIConnectionEvent).port;
    if (!port || port.type !== "input") return;
    if (port.state === "connected" && !cleanups.has(port.id)) {
      attach(port as MIDIInput);
    } else if (port.state === "disconnected") {
      const off = cleanups.get(port.id);
      if (off) { off(); cleanups.delete(port.id); }
    }
  };
  access.addEventListener("statechange", onState);

  return () => {
    access?.removeEventListener("statechange", onState);
    for (const off of cleanups.values()) off();
    cleanups.clear();
  };
}

// Subscribe to device-list changes. Returns the current list synchronously
// once and emits the new list whenever devices connect/disconnect.
export function watchDevices(onChange: (devices: MIDIDeviceInfo[]) => void): () => void {
  if (!access) return () => { /* not connected */ };
  onChange(listInputs());
  const handler = () => onChange(listInputs());
  access.addEventListener("statechange", handler);
  return () => access?.removeEventListener("statechange", handler);
}
