import { useState } from 'react';
import { Clock, Monitor, Moon, Sun } from 'lucide-react';

import { THEME_MODES, type ThemeMode, type ThemeState } from '@stxapps/shared';
import { type ThemeSource, useSettingMutations, useSettings } from '@stxapps/web-react';
import { Input } from '@stxapps/web-ui/components/ui/input';
import { Label } from '@stxapps/web-ui/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@stxapps/web-ui/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@stxapps/web-ui/components/ui/tabs';

// The extension's THEME picker — the one synced setting that actually applies here
// (layout/serverExtraction don't: the options/popup have no library list and never
// call brace-extractor). It mirrors brace-web's Settings → Misc theme block: a
// Sync/Device tab picks WHERE the choice lives (use-settings.ts resolves the applied
// value), and each tab's controls are bound to that source:
//   - Sync   → settings/general.enc, shared across the account's devices;
//   - Device → the off-sync localSettings store, this browser only (wiped on sign-out).
// The Device tab is what lets the extension keep its own theme (e.g. always-dark)
// without opening brace-web — see docs/theme.md "the sync/device split".

const THEME_MODE_OPTIONS: Record<
  ThemeMode,
  { label: string; hint: string; icon: React.ReactNode }
> = {
  light: {
    label: 'Light',
    hint: 'Always use the light theme.',
    icon: <Sun className="size-4" />,
  },
  dark: {
    label: 'Dark',
    hint: 'Always use the dark theme.',
    icon: <Moon className="size-4" />,
  },
  system: {
    label: 'System',
    hint: "Follow your device's appearance.",
    icon: <Monitor className="size-4" />,
  },
  custom: {
    label: 'Custom time',
    hint: 'Light by day, dark by night — you set the times.',
    icon: <Clock className="size-4" />,
  },
};

// A radio-row Label. `has-data-checked` styles the row when its radio is selected.
function OptionRow({
  id,
  value,
  label,
  hint,
  icon,
}: {
  id: string;
  value: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <Label
      htmlFor={id}
      className="flex items-start gap-3 rounded-lg border border-border p-3 has-data-checked:border-primary has-data-checked:bg-muted/40"
    >
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 font-medium">
          {icon}
          {label}
        </span>
        <span className="text-sm font-normal text-muted-foreground">{hint}</span>
      </span>
    </Label>
  );
}

// The four mode radios for one source, plus the two crossover-time inputs revealed
// only in `custom` mode. Source-agnostic: the parent binds `value`/`onChange` to the
// synced or the device ThemeState, and each edit emits a whole new ThemeState.
function ThemeControls({
  value,
  onChange,
}: {
  value: ThemeState;
  onChange: (theme: ThemeState) => void;
}) {
  return (
    <div className="mt-4">
      <RadioGroup
        value={value.mode}
        onValueChange={(v) => onChange({ ...value, mode: v as ThemeMode })}
      >
        {THEME_MODES.map((mode) => {
          const { label, hint, icon } = THEME_MODE_OPTIONS[mode];
          return (
            <OptionRow
              key={mode}
              id={`theme-${mode}`}
              value={mode}
              label={label}
              hint={hint}
              icon={icon}
            />
          );
        })}
      </RadioGroup>

      {value.mode === 'custom' && (
        <div className="mt-4 flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="theme-light-start">Light starts</Label>
            <Input
              id="theme-light-start"
              type="time"
              value={value.lightStart}
              onChange={(e) => onChange({ ...value, lightStart: e.target.value })}
              className="w-36"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="theme-dark-start">Dark starts</Label>
            <Input
              id="theme-dark-start"
              type="time"
              value={value.darkStart}
              onChange={(e) => onChange({ ...value, darkStart: e.target.value })}
              className="w-36"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function ThemeSection() {
  const { themeSource, syncTheme, localTheme } = useSettings();
  const { setThemeSource, setSyncTheme, setLocalTheme } = useSettingMutations();
  const [error, setError] = useState<string | null>(null);

  // Surface a failed write (e.g. the synced write with no active account) rather than
  // swallowing it; the controls stay live for a retry.
  const run = (op: Promise<unknown>) => {
    setError(null);
    void op.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <section>
      <h2 className="status-section-title">Theme</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose the extension's appearance. <strong>Sync</strong> applies your choice across all
        your devices. <strong>Device</strong> keeps a separate choice for this browser only (cleared
        when you sign out).
      </p>

      {error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Tabs
        value={themeSource}
        onValueChange={(v) => run(setThemeSource(v as ThemeSource))}
        className="mt-4"
      >
        <TabsList>
          <TabsTrigger value="sync">Sync</TabsTrigger>
          {/* The `'local'` source is labeled "Device" for users. */}
          <TabsTrigger value="local">Device</TabsTrigger>
        </TabsList>

        {/* One control set per tab, each bound to that source's value. The active tab
            is the active source (use-settings.ts), so the shown controls always reflect
            the theme the extension is rendering. */}
        <TabsContent value="sync">
          <ThemeControls value={syncTheme} onChange={(t) => run(setSyncTheme(t))} />
        </TabsContent>
        <TabsContent value="local">
          <ThemeControls value={localTheme} onChange={(t) => run(setLocalTheme(t))} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
