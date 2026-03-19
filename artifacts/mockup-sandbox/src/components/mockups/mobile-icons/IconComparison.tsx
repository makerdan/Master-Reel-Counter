import {
  Smartphone,
  Phone,
  PhoneCall,
  Tablet,
  TabletSmartphone,
  SmartphoneCharging,
  SmartphoneNfc,
  Signal,
  Navigation,
  Scan,
} from "lucide-react";

const icons = [
  { Icon: Smartphone, name: "Smartphone", note: "current" },
  { Icon: Phone, name: "Phone", note: "" },
  { Icon: PhoneCall, name: "PhoneCall", note: "" },
  { Icon: Tablet, name: "Tablet", note: "" },
  { Icon: TabletSmartphone, name: "TabletSmartphone", note: "" },
  { Icon: SmartphoneCharging, name: "SmartphoneCharging", note: "" },
  { Icon: SmartphoneNfc, name: "SmartphoneNfc", note: "" },
  { Icon: Signal, name: "Signal", note: "" },
  { Icon: Navigation, name: "Navigation", note: "" },
  { Icon: Scan, name: "Scan", note: "" },
];

export function IconComparison() {
  return (
    <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center p-8">
      <div className="space-y-6 w-full max-w-2xl">
        <h2 className="text-white text-lg font-semibold text-center tracking-wide">
          Mobile Flow — Icon Alternatives
        </h2>
        <div className="grid grid-cols-5 gap-4">
          {icons.map(({ Icon, name, note }) => (
            <div
              key={name}
              className={`flex flex-col items-center gap-3 rounded-xl p-4 border transition-colors cursor-pointer
                ${note === "current"
                  ? "bg-blue-600/20 border-blue-500/60"
                  : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/25"
                }`}
            >
              <div className={`rounded-lg p-3 ${note === "current" ? "bg-blue-600/30" : "bg-white/10"}`}>
                <Icon className={`h-7 w-7 ${note === "current" ? "text-blue-300" : "text-white/80"}`} />
              </div>
              <div className="text-center">
                <p className={`text-xs font-medium leading-tight ${note === "current" ? "text-blue-300" : "text-white/70"}`}>
                  {name}
                </p>
                {note && (
                  <p className="text-[10px] text-blue-400/80 mt-0.5">{note}</p>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="text-white/30 text-xs text-center">Click an icon in the app to switch — click to compare</p>
      </div>
    </div>
  );
}
