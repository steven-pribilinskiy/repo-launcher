import { getCurrentWindow } from "@tauri-apps/api/window";
import Popup from "@/components/Popup";
import Settings from "@/components/Settings";

export default function App() {
  return getCurrentWindow().label === "settings" ? <Settings /> : <Popup />;
}
