import { generatePassword } from "@ironkeep/shared";
import {
  Copy,
  CreditCard,
  FileText,
  Fingerprint,
  Heart,
  KeyRound,
  LockKeyhole,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import browser from "webextension-polyfill";
import { Button } from "./components/ui/Button.js";
import { PasswordInput } from "./components/ui/PasswordInput.js";
import { SearchInput } from "./components/ui/SearchInput.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/Tabs.js";
import type { ExtensionRequest, ExtensionResponse, PublicVaultItem } from "./runtime/types.js";

type ViewState = "loading" | "empty" | "locked" | "unlocked";

async function send(request: ExtensionRequest): Promise<ExtensionResponse> {
  return browser.runtime.sendMessage(request) as Promise<ExtensionResponse>;
}

function itemIcon(kind: PublicVaultItem["kind"]) {
  const props = { size: 18, strokeWidth: 1.8, "aria-hidden": true } as const;
  if (kind === "login") return <KeyRound {...props} />;
  if (kind === "creditCard") return <CreditCard {...props} />;
  if (kind === "identity") return <UserRound {...props} />;
  return <FileText {...props} />;
}

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-9 w-9 place-items-center border border-brass text-brass" aria-hidden="true">
        <Fingerprint size={21} strokeWidth={1.6} />
      </div>
      <div>
        <p className="font-display text-[22px] leading-5 tracking-[-0.02em] text-foreground">Ironkeep</p>
        <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.22em] text-muted-foreground">Local vault</p>
      </div>
    </div>
  );
}

function LoadingView() {
  return (
    <main className="grid min-h-[580px] place-items-center bg-background text-foreground" aria-label="Opening Ironkeep">
      <RefreshCw className="animate-spin text-brass motion-reduce:animate-none" aria-hidden="true" />
      <span className="sr-only">Opening Ironkeep</span>
    </main>
  );
}

function GateView({ mode, onOpen }: { mode: "empty" | "locked"; onOpen: () => void }) {
  const [creating, setCreating] = useState(mode === "empty");
  const [masterPassword, setMasterPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (creating && (masterPassword.length < 12 || masterPassword !== confirmation)) {
      setError(masterPassword.length < 12 ? "Use at least 12 characters." : "Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await send({ type: creating ? "CREATE_VAULT" : "UNLOCK", masterPassword });
      if (!response.ok) {
        setError(response.error === "AUTHENTICATION_FAILED" ? "Master password not accepted." : "Vault could not be opened.");
        return;
      }
      setMasterPassword("");
      setConfirmation("");
      onOpen();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative min-h-[580px] overflow-hidden bg-background px-6 pb-6 pt-5 text-foreground">
      <div className="absolute inset-y-0 right-0 w-px bg-line" aria-hidden="true" />
      <BrandMark />
      <div className="mb-12 mt-16 border-l-2 border-brass pl-5">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brass">Zero knowledge</p>
        <h1 className="max-w-[290px] font-display text-[38px] leading-[0.95] tracking-[-0.035em]">
          {creating ? "Forge your private keep." : "Open the keep."}
        </h1>
        <p className="mt-4 max-w-[300px] text-sm leading-6 text-muted-foreground">
          {creating ? "No account required. Your master password never leaves this device." : "Decrypt locally. Nothing is sent to Ironkeep."}
        </p>
      </div>
      <form className="space-y-5" onSubmit={submit}>
        <PasswordInput
          label="Master password"
          autoFocus
          autoComplete={creating ? "new-password" : "current-password"}
          value={masterPassword}
          onChange={(event) => setMasterPassword(event.target.value)}
          {...(creating ? { helperText: "Never recoverable by Ironkeep. Store a recovery copy safely." } : {})}
        />
        {creating ? (
          <PasswordInput
            label="Confirm master password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        ) : null}
        <div aria-live="polite" className="min-h-5 text-sm text-danger">{error}</div>
        <Button className="w-full" disabled={busy} type="submit">
          {busy ? <RefreshCw className="animate-spin motion-reduce:animate-none" size={16} aria-hidden="true" /> : <LockKeyhole size={17} aria-hidden="true" />}
          {creating ? "Create encrypted vault" : "Unlock locally"}
        </Button>
        {mode === "locked" ? (
          <p className="text-center text-xs text-muted-foreground">Biometric unlock is available in the Android app.</p>
        ) : null}
      </form>
    </main>
  );
}

function VaultList({ items }: { items: PublicVaultItem[] }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const searchRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(
    () => items.filter((item) => `${item.title} ${item.subtitle}`.toLowerCase().includes(deferredQuery)),
    [deferredQuery, items],
  );

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && event.ctrlKey) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <section aria-label="Vault items">
      <div className="border-b border-line px-4 py-4">
        <SearchInput ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search passwords, notes, cards…" />
      </div>
      {filtered.length ? (
        <ul className="divide-y divide-line">
          {filtered.map((item) => (
            <li key={item.id}>
              <button className="group grid w-full cursor-pointer grid-cols-[40px_1fr_36px] items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-subtle focus-visible:bg-subtle focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <span className="grid h-10 w-10 place-items-center border border-line bg-field text-brass">{itemIcon(item.kind)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-foreground">{item.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.subtitle}</span>
                </span>
                <span className="grid h-9 w-9 place-items-center text-muted-foreground group-hover:text-foreground">
                  <Heart size={16} fill={item.favorite ? "currentColor" : "none"} aria-label={item.favorite ? "Favorite" : "Not favorite"} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mx-4 my-10 border-y border-line py-10 text-center">
          <KeyRound className="mx-auto text-brass" size={28} strokeWidth={1.5} aria-hidden="true" />
          <h2 className="mt-4 font-display text-2xl">Nothing in this drawer.</h2>
          <p className="mx-auto mt-2 max-w-[250px] text-sm leading-6 text-muted-foreground">
            {items.length ? "No item matches this search." : "Add the first login, note, card, or identity."}
          </p>
          {!items.length ? <Button className="mt-5" size="compact"><Plus size={15} aria-hidden="true" />Add first item</Button> : null}
        </div>
      )}
    </section>
  );
}

function Generator() {
  const [length, setLength] = useState(20);
  const [password, setPassword] = useState(() => generatePassword({ length: 20 }));
  const [copied, setCopied] = useState(false);
  const regenerate = () => {
    setPassword(generatePassword({ length }));
    setCopied(false);
  };
  return (
    <section className="px-5 py-6" aria-labelledby="generator-title">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brass">Workshop</p>
      <h2 id="generator-title" className="mt-2 font-display text-3xl">Password generator</h2>
      <div className="mt-7 border-y border-line bg-field px-4 py-5">
        <p className="break-all font-mono text-base leading-7 text-foreground">{password}</p>
        <div className="mt-4 flex gap-2">
          <Button size="compact" onClick={regenerate}><RefreshCw size={14} aria-hidden="true" />Regenerate</Button>
          <Button
            size="compact"
            variant="outline"
            onClick={() => void navigator.clipboard.writeText(password).then(() => setCopied(true))}
          >
            <Copy size={14} aria-hidden="true" />{copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <label className="mt-6 flex items-center justify-between text-sm font-semibold" htmlFor="password-length">
        Length <span className="font-mono text-brass">{length}</span>
      </label>
      <input
        id="password-length"
        className="mt-3 w-full accent-brass"
        type="range"
        min="12"
        max="64"
        value={length}
        onChange={(event) => { setLength(Number(event.target.value)); setCopied(false); }}
        onPointerUp={regenerate}
        onKeyUp={regenerate}
      />
      <p aria-live="polite" className="mt-6 text-xs leading-5 text-muted-foreground">Generated locally with rejection-sampled cryptographic randomness. Clipboard clearing is enforced by the full runtime.</p>
    </section>
  );
}

function SettingsPanel() {
  return (
    <section className="px-5 py-6" aria-labelledby="settings-title">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brass">Control room</p>
      <h2 id="settings-title" className="mt-2 font-display text-3xl">Settings</h2>
      <dl className="mt-7 divide-y divide-line border-y border-line">
        <div className="flex items-center justify-between py-4"><dt className="text-sm font-semibold">Auto-lock</dt><dd className="text-sm text-muted-foreground">5 minutes</dd></div>
        <div className="flex items-center justify-between py-4"><dt className="text-sm font-semibold">Clipboard clear</dt><dd className="text-sm text-muted-foreground">30 seconds</dd></div>
        <div className="flex items-center justify-between py-4"><dt className="text-sm font-semibold">Google Drive</dt><dd className="text-sm text-muted-foreground">Not connected</dd></div>
      </dl>
      <Button className="mt-6 w-full" variant="outline"><ShieldCheck size={16} aria-hidden="true" />Connect Google Drive</Button>
    </section>
  );
}

function UnlockedView({ onLock }: { onLock: () => void }) {
  const [items, setItems] = useState<PublicVaultItem[]>([]);
  useEffect(() => {
    void send({ type: "LIST_ITEMS" }).then((response) => {
      if (response.ok && "items" in response) setItems(response.items);
      else if (!response.ok && response.error === "LOCKED") onLock();
    });
  }, [onLock]);

  return (
    <main className="min-h-[580px] bg-background text-foreground">
      <header className="flex h-16 items-center justify-between border-b border-line px-4">
        <BrandMark />
        <Button variant="ghost" size="icon" aria-label="Lock vault" onClick={() => void send({ type: "LOCK" }).then(onLock)}>
          <LockKeyhole size={18} aria-hidden="true" />
        </Button>
      </header>
      <Tabs defaultValue="vault">
        <TabsList aria-label="Ironkeep sections">
          <TabsTrigger value="vault"><KeyRound className="mr-1 inline" size={14} aria-hidden="true" />Vault</TabsTrigger>
          <TabsTrigger value="generator"><RefreshCw className="mr-1 inline" size={14} aria-hidden="true" />Generate</TabsTrigger>
          <TabsTrigger value="settings"><Settings className="mr-1 inline" size={14} aria-hidden="true" />Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="vault"><VaultList items={items} /></TabsContent>
        <TabsContent value="generator"><Generator /></TabsContent>
        <TabsContent value="settings"><SettingsPanel /></TabsContent>
      </Tabs>
    </main>
  );
}

export function App() {
  const [view, setView] = useState<ViewState>("loading");
  useEffect(() => {
    void send({ type: "STATUS" }).then((response) => {
      setView(response.ok && "status" in response ? response.status : "locked");
    });
  }, []);
  if (view === "loading") return <LoadingView />;
  if (view === "empty" || view === "locked") return <GateView mode={view} onOpen={() => setView("unlocked")} />;
  return <UnlockedView onLock={() => setView("locked")} />;
}
