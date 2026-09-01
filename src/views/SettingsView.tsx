import { Skin, ThemePref } from "../theme";
import { Dropdown, Segmented } from "../ui/controls";

export function SettingsView(props: {
  themePref: ThemePref;
  skin: Skin;
  onThemePref: (pref: ThemePref) => void;
  onSkin: (skin: Skin) => void;
}) {
  const themeLocked = props.skin !== "apple";

  return (
    <>
      <div className="main-header">
        <div>
          <h1>Settings</h1>
          <div className="subtitle">Appearance and app behavior.</div>
        </div>
      </div>

      <div className="main-body">
        <div className="card">
          <div className="settings-row">
            <div>
              <div className="row-label">Appearance</div>
              <div className="row-sub">
                {themeLocked
                  ? "This skin has a fixed appearance."
                  : "Follow the system, or force light/dark."}
              </div>
            </div>
            <div className="row-control">
              {!themeLocked && (
                <Segmented<ThemePref>
                  ariaLabel="Appearance"
                  value={props.themePref}
                  options={[
                    { value: "system", label: "System" },
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                  onChange={props.onThemePref}
                />
              )}
            </div>
          </div>
          <div className="settings-row">
            <div>
              <div className="row-label">Skin</div>
              <div className="row-sub">
                Skins restyle the whole app by overriding design tokens.
              </div>
            </div>
            <div className="row-control">
              <Dropdown
                ariaLabel="Skin"
                value={props.skin}
                options={[
                  { value: "apple", label: "Apple", sub: "light & dark" },
                  { value: "cyberpunk", label: "Cyberpunk", sub: "always dark" },
                  { value: "xp", label: "XP", sub: "always light" },
                ]}
                onChange={(v) => props.onSkin(v as Skin)}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
