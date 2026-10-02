import { Label, ProgressBar, Tooltip } from "@heroui/react";
import { cx } from "../lib/cx";
import { limitOf, usageOf, type Rule } from "../lib/data";
import { useFormat, useT } from "../lib/prefs";
import { FLAME_COLOR, Flames } from "./Flames";

type Level = "ok" | "near" | "held";

// Share of the limit from which an OK tracker counts as near its hold.
const NEAR = 0.9;

const LEVEL_COLOR: Record<Level, "success" | "warning" | "danger"> = {
  ok: "success",
  near: "warning",
  held: "danger",
};

interface UsageBarProps {
  rule: Rule;
  faded?: boolean;
  // Whether a rule limits the tracker. With none there's no limit to keep, so
  // the tooltip says so.
  limited?: boolean;
  // How long a freeleech still runs, in ms. While it does, a burning box
  // takes the bar's place.
  freeleechLeft?: number;
}

// Downloaded against the limit, colored by how close the tracker is to its hold.
// Only an enabled rule has colors. A tracker with no rule is only measured, so
// its bar is faded too.
export function UsageBar({ rule, faded = false, limited = true, freeleechLeft = 0 }: UsageBarProps) {
  const t = useT();
  const format = useFormat();
  if (freeleechLeft > 0) return <FreeleechBox left={freeleechLeft} faded={faded} />;

  const held = rule.enabled && rule.state === "held";
  const limit = limitOf(rule);
  const used = usageOf(rule);
  // Past its limit, a tracker shows as held even before the next poll holds it.
  const level: Level = held || used >= 1 ? "held" : used >= NEAR ? "near" : "ok";

  return (
    // HeroUI has no faded color, so the bar's own wrapper fades it, at the user's request.
    <div className={cx(faded && "opacity-40")}>
      {/* The bar stops at 100%, so its label shows how far past the limit a hold is. */}
      <ProgressBar
        value={Math.min(used, 1) * 100}
        valueLabel={Number.isFinite(used) ? `${Math.round(used * 100)}%` : "∞"}
        color={rule.enabled ? LEVEL_COLOR[level] : "default"}
      >
        <Label>
          {/* The label only has what's downloaded, so the tooltip has the limit. */}
          <Tooltip>
            <Tooltip.Trigger>
              <span className="cursor-help">{format.gb(rule.downloadedGiB)}</span>
            </Tooltip.Trigger>
            <Tooltip.Content>
              {limited ? t("Max {size} to keep the ratio", { size: format.gb(limit) }) : t("No rule, so no limit")}
            </Tooltip.Content>
          </Tooltip>
        </Label>
        <ProgressBar.Output />
        <ProgressBar.Track>
          {faded ? (
            // The fill is white in the dark theme, too strong even faded, so it
            // fades further. It sizes against the track, which it still does
            // through this wrapper.
            <div className="opacity-30">
              <ProgressBar.Fill />
            </div>
          ) : (
            <ProgressBar.Fill />
          )}
        </ProgressBar.Track>
      </ProgressBar>
    </div>
  );
}

// What stands for the bar on a freeleech, and burns. What a freeleech downloads
// doesn't count, so there's nothing to measure: it only says how long the
// freeleech still runs, in white and centered, on the flames' own red, all at
// the user's request. The wrapper keeps the flames behind it.
function FreeleechBox({ left, faded }: { left: number; faded: boolean }) {
  const t = useT();
  const format = useFormat();
  return (
    <div className={cx("isolate", faded && "opacity-40")}>
      <Flames>
        <div
          className="flex h-3.5 items-center justify-center rounded-sm text-[10px] leading-none font-medium text-white"
          style={{ backgroundColor: FLAME_COLOR }}
        >
          <Tooltip>
            <Tooltip.Trigger>
              <span className="cursor-help">{t("{time} left", { time: format.left(left) })}</span>
            </Tooltip.Trigger>
            <Tooltip.Content>{t("Downloads don't count during the freeleech")}</Tooltip.Content>
          </Tooltip>
        </div>
      </Flames>
    </div>
  );
}
