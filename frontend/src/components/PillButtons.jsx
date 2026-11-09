import { useEffect, useMemo, useState } from 'react';
import { gptCss, loadSettings, pillCss, themeMedia } from '../beerus';

/**
 * The card's real pills (same icon, colour, shape and style as on the card and in Settings) as buttons.
 * Used wherever you choose a pill: the PDF capture dialog and the capture tray.
 * `variant="icon"` shows just the round icon (name in the tooltip) for tight places.
 */
export default function PillButtons({ onPick, variant = 'full', showKeys = false, keyOffset = 1, count = 8 }) {
  const [settings, setSettings] = useState(() => loadSettings());
  useEffect(() => {
    const refresh = () => setSettings(loadSettings());
    window.addEventListener('beerus-settings-saved', refresh);
    return () => window.removeEventListener('beerus-settings-saved', refresh);
  }, []);
  const css = useMemo(() => {
    let text = pillCss(settings) + gptCss(settings);
    themeMedia(settings).forEach(file => { text = text.split(file.name).join(file.dataUrl); });
    return text;
  }, [settings]);
  const compact = variant === 'icon';
  const scale = compact ? 0.62 : 0.85;
  const px = compact ? 11 : 14.5;
  return (
    <div className={`pb-group bs-${settings.pillStyle.style}${compact ? ' pb-compact' : ''}`} style={{ '--ics': 1, '--gs': scale, fontSize: `${px}px` }}>
      <style>{css}</style>
      {settings.pills.slice(0, count).map((pill, index) => {
        const icon = !settings.pillStyle.showIcons || pill.iconType === 'none' ? null
          : pill.iconType === 'emoji' ? (pill.icon ? <span className="bpill-em">{pill.icon}</span> : null)
            : <span className="bpill-ic" />;
        return (
          <button key={index} type="button" className="pb-btn" onClick={() => onPick(`pill${index + 1}`, index)} title={`Add to the ${pill.label} pill`} aria-label={`Add to the ${pill.label} pill`}>
            {showKeys && index < 4 && <kbd>{index + keyOffset + 3}</kbd>}
            <div className={`bpill bpill-${index + 1}`}>
              <summary>{icon}{(!compact || !icon) && <span className="bpill-label">{compact ? pill.label.slice(0, 1) : pill.label}</span>}</summary>
            </div>
          </button>
        );
      })}
    </div>
  );
}
