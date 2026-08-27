import { generatePassword } from "@ironkeep/shared";
import {
  ArrowLeft,
  Copy,
  CreditCard,
  FileText,
  Fingerprint,
  Heart,
  KeyRound,
  LockKeyhole,
  Plus,
  Save,
  Trash2,
  RefreshCw,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import browser from "webextension-polyfill";
import { Button } from "./components/ui/Button.js";
import { Input } from "./components/ui/Input.js";
import { PasswordInput } from "./components/ui/PasswordInput.js";
import { SearchInput } from "./components/ui/SearchInput.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/Tabs.js";
import { LEGAL_DOCUMENTS, parseLegalMarkdown, type LegalDocumentKind } from "./legal.js";
import type { ExtensionRequest, ExtensionResponse, PublicCreditCard, PublicIdentity, PublicLogin, PublicSecureNote, PublicSecuritySettings, PublicVaultItem } from "./runtime/types.js";

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

function LegalLinks({ idPrefix, onOpen }: { idPrefix: string; onOpen: (kind: LegalDocumentKind, triggerId: string) => void }) {
  return (
    <section className="border-y border-line py-5" aria-labelledby={`${idPrefix}-legal-title`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brass">Legal</p>
      <h2 id={`${idPrefix}-legal-title`} className="mt-2 text-sm font-semibold text-foreground">Your rights and privacy</h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        By using Ironkeep, you agree to the Terms of Use and acknowledge the Privacy Notice.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button id={`${idPrefix}-privacy`} className="min-h-11" type="button" variant="outline" onClick={() => onOpen("privacy", `${idPrefix}-privacy`)}>
          Privacy notice
        </Button>
        <Button id={`${idPrefix}-terms`} className="min-h-11" type="button" variant="outline" onClick={() => onOpen("terms", `${idPrefix}-terms`)}>
          Terms of use
        </Button>
      </div>
    </section>
  );
}

function LegalDocumentView({ kind, onBack }: { kind: LegalDocumentKind; onBack: () => void }) {
  const legalDocument = LEGAL_DOCUMENTS[kind];
  const blocks = useMemo(() => parseLegalMarkdown(legalDocument.source), [legalDocument.source]);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [kind]);

  return (
    <main className="h-[580px] overflow-y-auto bg-background text-foreground" aria-labelledby="legal-document-title">
      <header className="sticky top-0 z-10 flex min-h-16 items-center gap-2 border-b border-line bg-background px-3">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" />
        </Button>
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-brass">Ironkeep legal</p>
          <h1 id="legal-document-title" ref={headingRef} tabIndex={-1} className="truncate font-display text-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {legalDocument.title}
          </h1>
        </div>
      </header>
      <div className="space-y-4 px-5 py-6">
        {blocks.map((block, index) => {
          if (block.kind === "heading") {
            return <h2 key={`${block.kind}-${index}`} className="pt-3 font-display text-2xl leading-tight text-foreground">{block.text}</h2>;
          }
          if (block.kind === "bullet") {
            return (
              <div key={`${block.kind}-${index}`} className="grid grid-cols-[12px_1fr] gap-2 text-sm leading-6 text-muted-foreground">
                <span className="text-brass" aria-hidden="true">•</span>
                <p>{block.text}</p>
              </div>
            );
          }
          return <p key={`${block.kind}-${index}`} className="text-sm leading-6 text-muted-foreground">{block.text}</p>;
        })}
        <p className="border-t border-line pt-5 text-xs leading-5 text-muted-foreground">Bundled from the canonical project notice.</p>
      </div>
    </main>
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

function GateView({ mode, onOpen, onLegal }: { mode: "empty" | "locked"; onOpen: () => void; onLegal: (kind: LegalDocumentKind, triggerId: string) => void }) {
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
      <div className="mt-8">
        <LegalLinks idPrefix="gate" onOpen={onLegal} />
      </div>
    </main>
  );
}

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1.5 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground"><span>{label}</span>{children}</label>;
}

function SiteMatches({ refreshKey }: { refreshKey: number }) {
  const [matches, setMatches] = useState<PublicVaultItem[]>([]);
  const [tabId, setTabId] = useState<number | null>(null);
  useEffect(() => {
    void browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (typeof tab?.id !== "number") return;
      setTabId(tab.id);
      const response = await send({ type: "GET_MATCHES", tabId: tab.id });
      setMatches(response.ok && "items" in response ? response.items : []);
    });
  }, [refreshKey]);
  if (!matches.length || tabId === null) return null;
  return (
    <section className="border-b border-line bg-field px-4 py-3" aria-label="Logins for active site">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brass">Active site</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {matches.map((item) => <Button key={item.id} size="compact" variant="outline" onClick={() => void send({ type: "FILL_ITEM", itemId: item.id, tabId })}>{item.title} · {item.subtitle}</Button>)}
      </div>
    </section>
  );
}

function LoginEditor({ item, onCancel, onSaved }: { item: PublicLogin | null; onCancel: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [username, setUsername] = useState(item?.username ?? "");
  const [password, setPassword] = useState(item?.password ?? "");
  const [uris, setUris] = useState(item?.uris.join("\n") ?? "");
  const [packages, setPackages] = useState(item?.androidPackageNames.join("\n") ?? "");
  const [error, setError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(confirmDuplicate = false) {
    setError("");
    setDuplicateWarning("");
    if (!title.trim() || !password) {
      setError("Title and password are required.");
      return;
    }
    setBusy(true);
    const fields = {
      title,
      username,
      password,
      uris: uris.split(/\r?\n/u),
      androidPackageNames: packages.split(/\r?\n/u),
    };
    try {
      const response = await send(item
        ? { type: "UPDATE_LOGIN", itemId: item.id, fields, confirmDuplicate }
        : { type: "CREATE_LOGIN", fields, confirmDuplicate });
      if (response.ok) {
        onSaved();
      } else if (response.error === "DUPLICATE") {
        setDuplicateWarning(`Likely duplicate: ${response.items.map((candidate) => candidate.title).join(", ")}.`);
      } else {
        setError(response.error === "PERSISTENCE_FAILED" ? "Encrypted vault could not be saved. Previous data is intact." : "Login could not be saved.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!item || !window.confirm(`Delete ${item.title}? This creates a sync tombstone.`)) return;
    setBusy(true);
    try {
      const response = await send({ type: "DELETE_LOGIN", itemId: item.id, confirmed: true });
      if (response.ok) onSaved();
      else setError(response.error === "PERSISTENCE_FAILED" ? "Encrypted vault could not be saved. Previous data is intact." : "Login could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  const textareaClass = "min-h-20 w-full resize-y border border-line bg-field px-3 py-2 text-sm text-foreground outline-none focus:border-brass focus:ring-2 focus:ring-brass/20";
  return (
    <form className="space-y-4 px-5 py-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brass">Login record</p><h2 className="mt-1 font-display text-3xl">{item ? "Edit login" : "Add login"}</h2></div>
      <FieldLabel label="Title"><Input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></FieldLabel>
      <FieldLabel label="Username, email, or phone"><Input value={username} onChange={(event) => setUsername(event.target.value)} /></FieldLabel>
      <PasswordInput label="Password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
      <FieldLabel label="Website URIs, one per line"><textarea className={textareaClass} value={uris} onChange={(event) => setUris(event.target.value)} placeholder="https://example.com" /></FieldLabel>
      <FieldLabel label="Android packages, one per line"><textarea className={textareaClass} value={packages} onChange={(event) => setPackages(event.target.value)} placeholder="com.example.app" /></FieldLabel>
      <div aria-live="polite" className="min-h-5 text-sm text-danger">{error || duplicateWarning}</div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}><Save size={15} aria-hidden="true" />Save encrypted</Button>
        {duplicateWarning ? <Button type="button" variant="outline" disabled={busy} onClick={() => void save(true)}>Save anyway</Button> : null}
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        {item ? <Button className="text-danger" type="button" variant="ghost" disabled={busy} onClick={() => void remove()}><Trash2 size={15} aria-hidden="true" />Delete</Button> : null}
      </div>
    </form>
  );
}

function SecureNoteEditor({ item, onCancel, onSaved }: { item: PublicSecureNote | null; onCancel: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [error, setError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(confirmDuplicate = false) {
    setError("");
    setDuplicateWarning("");
    if (!title.trim() || !body.trim()) {
      setError("Title and note body are required.");
      return;
    }
    setBusy(true);
    try {
      const fields = { title, body };
      const response = await send(item
        ? { type: "UPDATE_SECURE_NOTE", itemId: item.id, fields, confirmDuplicate }
        : { type: "CREATE_SECURE_NOTE", fields, confirmDuplicate });
      if (response.ok) onSaved();
      else if (response.error === "DUPLICATE") setDuplicateWarning(`Likely duplicate: ${response.items.map((candidate) => candidate.title).join(", ")}.`);
      else setError(response.error === "PERSISTENCE_FAILED" ? "Encrypted vault could not be saved. Previous data is intact." : "Secure note could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!item || !window.confirm(`Delete ${item.title}? This creates a sync tombstone.`)) return;
    setBusy(true);
    try {
      const response = await send({ type: "DELETE_SECURE_NOTE", itemId: item.id, confirmed: true });
      if (response.ok) onSaved();
      else setError(response.error === "PERSISTENCE_FAILED" ? "Encrypted vault could not be saved. Previous data is intact." : "Secure note could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4 px-5 py-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brass">Secure note</p><h2 className="mt-1 font-display text-3xl">{item ? "Edit note" : "Add note"}</h2></div>
      <FieldLabel label="Title"><Input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></FieldLabel>
      <FieldLabel label="Private note"><textarea className="min-h-48 w-full resize-y border border-line bg-field px-3 py-2 text-sm text-foreground outline-none focus:border-brass focus:ring-2 focus:ring-brass/20" value={body} onChange={(event) => setBody(event.target.value)} /></FieldLabel>
      <div aria-live="polite" className="min-h-5 text-sm text-danger">{error || duplicateWarning}</div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}><Save size={15} aria-hidden="true" />Save encrypted</Button>
        {duplicateWarning ? <Button type="button" variant="outline" disabled={busy} onClick={() => void save(true)}>Save anyway</Button> : null}
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        {item ? <Button className="text-danger" type="button" variant="ghost" disabled={busy} onClick={() => void remove()}><Trash2 size={15} aria-hidden="true" />Delete</Button> : null}
      </div>
    </form>
  );
}

function CreditCardEditor({ item, onCancel, onSaved }: { item: PublicCreditCard | null; onCancel: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [cardholderName, setCardholderName] = useState(item?.cardholderName ?? "");
  const [number, setNumber] = useState(item?.number ?? "");
  const [expiryMonth, setExpiryMonth] = useState(item?.expiryMonth ?? 1);
  const [expiryYear, setExpiryYear] = useState(item?.expiryYear ?? new Date().getUTCFullYear());
  const [verificationCode, setVerificationCode] = useState(item?.verificationCode ?? "");
  const [pin, setPin] = useState(item?.pin ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [error, setError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(confirmDuplicate = false) {
    setError("");
    setDuplicateWarning("");
    if (!title.trim() || !cardholderName.trim() || !/^\d{12,19}$/u.test(number.replace(/[\s-]/gu, "")) || expiryMonth < 1 || expiryMonth > 12 || expiryYear < 2000 || !/^\d{3,4}$/u.test(verificationCode)) {
      setError("Enter a title, cardholder, valid card number, expiry, and verification code.");
      return;
    }
    setBusy(true);
    try {
      const fields = { title, cardholderName, number, expiryMonth, expiryYear, verificationCode, ...(pin ? { pin } : {}), notes };
      const response = await send(item
        ? { type: "UPDATE_CREDIT_CARD", itemId: item.id, fields, confirmDuplicate }
        : { type: "CREATE_CREDIT_CARD", fields, confirmDuplicate });
      if (response.ok) onSaved();
      else if (response.error === "DUPLICATE") setDuplicateWarning("A card with this number already exists.");
      else setError(response.error === "PERSISTENCE_FAILED" ? "Encrypted vault could not be saved. Previous data is intact." : "Credit card could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!item || !window.confirm(`Delete ${item.title}? This creates a sync tombstone.`)) return;
    setBusy(true);
    try {
      const response = await send({ type: "DELETE_CREDIT_CARD", itemId: item.id, confirmed: true });
      if (response.ok) onSaved();
      else setError(response.error === "PERSISTENCE_FAILED" ? "Encrypted vault could not be saved. Previous data is intact." : "Credit card could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  const textareaClass = "min-h-20 w-full resize-y border border-line bg-field px-3 py-2 text-sm text-foreground outline-none focus:border-brass focus:ring-2 focus:ring-brass/20";
  return (
    <form className="space-y-4 px-5 py-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brass">Payment card</p><h2 className="mt-1 font-display text-3xl">{item ? "Edit card" : "Add card"}</h2></div>
      <FieldLabel label="Title"><Input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></FieldLabel>
      <FieldLabel label="Cardholder name"><Input value={cardholderName} onChange={(event) => setCardholderName(event.target.value)} /></FieldLabel>
      <PasswordInput label="Card number" value={number} onChange={(event) => setNumber(event.target.value)} autoComplete="cc-number" />
      <div className="grid grid-cols-2 gap-3">
        <FieldLabel label="Expiry month"><Input inputMode="numeric" value={String(expiryMonth)} onChange={(event) => setExpiryMonth(Number(event.target.value))} /></FieldLabel>
        <FieldLabel label="Expiry year"><Input inputMode="numeric" value={String(expiryYear)} onChange={(event) => setExpiryYear(Number(event.target.value))} /></FieldLabel>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <PasswordInput label="Verification code" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} autoComplete="cc-csc" />
        <PasswordInput label="PIN (optional)" value={pin} onChange={(event) => setPin(event.target.value)} autoComplete="off" />
      </div>
      <FieldLabel label="Notes"><textarea className={textareaClass} value={notes} onChange={(event) => setNotes(event.target.value)} /></FieldLabel>
      <div aria-live="polite" className="min-h-5 text-sm text-danger">{error || duplicateWarning}</div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}><Save size={15} aria-hidden="true" />Save encrypted</Button>
        {duplicateWarning ? <Button type="button" variant="outline" disabled={busy} onClick={() => void save(true)}>Save anyway</Button> : null}
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        {item ? <Button className="text-danger" type="button" variant="ghost" disabled={busy} onClick={() => void remove()}><Trash2 size={15} aria-hidden="true" />Delete</Button> : null}
      </div>
    </form>
  );
}

function IdentityEditor({ item, onCancel, onSaved }: { item: PublicIdentity | null; onCancel: () => void; onSaved: () => void }) {
  const [fields, setFields] = useState(() => ({
    title: item?.title ?? "", firstName: item?.firstName ?? "", middleName: item?.middleName ?? "", lastName: item?.lastName ?? "",
    email: item?.email ?? "", phone: item?.phone ?? "", company: item?.company ?? "", addressLine1: item?.addressLine1 ?? "",
    addressLine2: item?.addressLine2 ?? "", city: item?.city ?? "", region: item?.region ?? "", postalCode: item?.postalCode ?? "",
    country: item?.country ?? "", notes: item?.notes ?? "",
  }));
  const [error, setError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (key: keyof typeof fields) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFields((current) => ({ ...current, [key]: event.target.value }));
    setError("");
  };

  async function save(confirmDuplicate = false) {
    setError("");
    setDuplicateWarning("");
    const hasDetails = Object.entries(fields).some(([key, value]) => key !== "title" && key !== "notes" && value.trim());
    if (!fields.title.trim() || !hasDetails || (fields.email && !fields.email.includes("@"))) {
      setError("Enter a title and at least one valid identity field.");
      return;
    }
    setBusy(true);
    try {
      const response = await send(item
        ? { type: "UPDATE_IDENTITY", itemId: item.id, fields, confirmDuplicate }
        : { type: "CREATE_IDENTITY", fields, confirmDuplicate });
      if (response.ok) onSaved();
      else if (response.error === "DUPLICATE") setDuplicateWarning("An identity with this email or name already exists.");
      else setError(response.error === "PERSISTENCE_FAILED" ? "Encrypted vault could not be saved. Previous data is intact." : "Identity could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!item || !window.confirm(`Delete ${item.title}? This creates a sync tombstone.`)) return;
    setBusy(true);
    try {
      const response = await send({ type: "DELETE_IDENTITY", itemId: item.id, confirmed: true });
      if (response.ok) onSaved();
      else setError(response.error === "PERSISTENCE_FAILED" ? "Encrypted vault could not be saved. Previous data is intact." : "Identity could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  const textareaClass = "min-h-20 w-full resize-y border border-line bg-field px-3 py-2 text-sm text-foreground outline-none focus:border-brass focus:ring-2 focus:ring-brass/20";
  return (
    <form className="space-y-4 px-5 py-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brass">Identity record</p><h2 className="mt-1 font-display text-3xl">{item ? "Edit identity" : "Add identity"}</h2></div>
      <FieldLabel label="Title"><Input autoFocus value={fields.title} onChange={update("title")} /></FieldLabel>
      <div className="grid grid-cols-2 gap-3"><FieldLabel label="First name"><Input value={fields.firstName} onChange={update("firstName")} /></FieldLabel><FieldLabel label="Last name"><Input value={fields.lastName} onChange={update("lastName")} /></FieldLabel></div>
      <FieldLabel label="Middle name"><Input value={fields.middleName} onChange={update("middleName")} /></FieldLabel>
      <FieldLabel label="Email"><Input type="email" value={fields.email} onChange={update("email")} /></FieldLabel>
      <FieldLabel label="Phone"><Input type="tel" value={fields.phone} onChange={update("phone")} /></FieldLabel>
      <FieldLabel label="Company"><Input value={fields.company} onChange={update("company")} /></FieldLabel>
      <FieldLabel label="Address line 1"><Input value={fields.addressLine1} onChange={update("addressLine1")} /></FieldLabel>
      <FieldLabel label="Address line 2"><Input value={fields.addressLine2} onChange={update("addressLine2")} /></FieldLabel>
      <div className="grid grid-cols-2 gap-3"><FieldLabel label="City"><Input value={fields.city} onChange={update("city")} /></FieldLabel><FieldLabel label="Region"><Input value={fields.region} onChange={update("region")} /></FieldLabel></div>
      <div className="grid grid-cols-2 gap-3"><FieldLabel label="Postal code"><Input value={fields.postalCode} onChange={update("postalCode")} /></FieldLabel><FieldLabel label="Country"><Input value={fields.country} onChange={update("country")} /></FieldLabel></div>
      <FieldLabel label="Notes"><textarea className={textareaClass} value={fields.notes} onChange={update("notes")} /></FieldLabel>
      <div aria-live="polite" className="min-h-5 text-sm text-danger">{error || duplicateWarning}</div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}><Save size={15} aria-hidden="true" />Save encrypted</Button>
        {duplicateWarning ? <Button type="button" variant="outline" disabled={busy} onClick={() => void save(true)}>Save anyway</Button> : null}
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        {item ? <Button className="text-danger" type="button" variant="ghost" disabled={busy} onClick={() => void remove()}><Trash2 size={15} aria-hidden="true" />Delete</Button> : null}
      </div>
    </form>
  );
}

type VaultEditor =
  | { kind: "login"; item: PublicLogin | null }
  | { kind: "secureNote"; item: PublicSecureNote | null }
  | { kind: "creditCard"; item: PublicCreditCard | null }
  | { kind: "identity"; item: PublicIdentity | null };

function VaultList({ items, onChanged }: { items: PublicVaultItem[]; onChanged: () => void }) {
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<VaultEditor | null>(null);
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

  async function edit(item: PublicVaultItem) {
    if (item.kind === "login") {
      const response = await send({ type: "GET_LOGIN", itemId: item.id });
      if (response.ok && "item" in response && response.item.kind === "login") setEditor({ kind: "login", item: response.item });
    } else if (item.kind === "secureNote") {
      const response = await send({ type: "GET_SECURE_NOTE", itemId: item.id });
      if (response.ok && "item" in response && response.item.kind === "secureNote") setEditor({ kind: "secureNote", item: response.item });
    } else if (item.kind === "creditCard") {
      const response = await send({ type: "GET_CREDIT_CARD", itemId: item.id });
      if (response.ok && "item" in response && response.item.kind === "creditCard") setEditor({ kind: "creditCard", item: response.item });
    } else if (item.kind === "identity") {
      const response = await send({ type: "GET_IDENTITY", itemId: item.id });
      if (response.ok && "item" in response && response.item.kind === "identity") setEditor({ kind: "identity", item: response.item });
    }
  }

  async function toggle(item: PublicVaultItem) {
    if (item.kind !== "login" && item.kind !== "secureNote" && item.kind !== "creditCard" && item.kind !== "identity") return;
    const response = await send(item.kind === "login"
      ? { type: "TOGGLE_LOGIN_FAVORITE", itemId: item.id }
      : item.kind === "secureNote"
        ? { type: "TOGGLE_SECURE_NOTE_FAVORITE", itemId: item.id }
        : item.kind === "creditCard"
          ? { type: "TOGGLE_CREDIT_CARD_FAVORITE", itemId: item.id }
          : { type: "TOGGLE_IDENTITY_FAVORITE", itemId: item.id });
    if (response.ok) onChanged();
  }

  if (editor?.kind === "login") return <LoginEditor item={editor.item} onCancel={() => setEditor(null)} onSaved={() => { setEditor(null); onChanged(); }} />;
  if (editor?.kind === "secureNote") return <SecureNoteEditor item={editor.item} onCancel={() => setEditor(null)} onSaved={() => { setEditor(null); onChanged(); }} />;
  if (editor?.kind === "creditCard") return <CreditCardEditor item={editor.item} onCancel={() => setEditor(null)} onSaved={() => { setEditor(null); onChanged(); }} />;
  if (editor?.kind === "identity") return <IdentityEditor item={editor.item} onCancel={() => setEditor(null)} onSaved={() => { setEditor(null); onChanged(); }} />;

  return (
    <section aria-label="Vault items">
      <div className="space-y-2 border-b border-line px-4 py-4">
        <SearchInput ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vault…" />
        <div className="grid grid-cols-4 gap-2">
          <Button size="compact" aria-label="Add login" onClick={() => setEditor({ kind: "login", item: null })}><Plus size={15} aria-hidden="true" />Login</Button>
          <Button size="compact" variant="outline" aria-label="Add secure note" onClick={() => setEditor({ kind: "secureNote", item: null })}><Plus size={15} aria-hidden="true" />Note</Button>
          <Button size="compact" variant="outline" aria-label="Add credit card" onClick={() => setEditor({ kind: "creditCard", item: null })}><Plus size={15} aria-hidden="true" />Card</Button>
          <Button size="compact" variant="outline" aria-label="Add identity" onClick={() => setEditor({ kind: "identity", item: null })}><Plus size={15} aria-hidden="true" />ID</Button>
        </div>
      </div>
      {filtered.length ? (
        <ul className="divide-y divide-line">
          {filtered.map((item) => (
            <li key={item.id}>
              <div className="group grid w-full grid-cols-[1fr_48px] items-center transition-colors hover:bg-subtle">
                <button onClick={() => void edit(item)} className="grid cursor-pointer grid-cols-[40px_1fr] items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <span className="grid h-10 w-10 place-items-center border border-line bg-field text-brass">{itemIcon(item.kind)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">{item.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.subtitle}</span>
                  </span>
                </button>
                {item.kind === "login" || item.kind === "secureNote" || item.kind === "creditCard" || item.kind === "identity" ? (
                  <button type="button" onClick={() => void toggle(item)} aria-label={item.favorite ? `Remove ${item.title} from favorites` : `Add ${item.title} to favorites`} className="grid h-12 w-12 place-items-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <Heart size={16} fill={item.favorite ? "currentColor" : "none"} aria-hidden="true" />
                  </button>
                ) : <span aria-hidden="true" />}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mx-4 my-10 border-y border-line py-10 text-center">
          <KeyRound className="mx-auto text-brass" size={28} strokeWidth={1.5} aria-hidden="true" />
          <h2 className="mt-4 font-display text-2xl">Nothing in this drawer.</h2>
          <p className="mx-auto mt-2 max-w-[250px] text-sm leading-6 text-muted-foreground">
            {items.length ? "No vault item matches this search." : "Add the first login, secure note, payment card, or identity to this encrypted vault."}
          </p>
          {!items.length ? <div className="mt-5 flex flex-wrap justify-center gap-2"><Button size="compact" onClick={() => setEditor({ kind: "login", item: null })}><Plus size={15} aria-hidden="true" />Login</Button><Button size="compact" variant="outline" onClick={() => setEditor({ kind: "secureNote", item: null })}><Plus size={15} aria-hidden="true" />Note</Button><Button size="compact" variant="outline" onClick={() => setEditor({ kind: "creditCard", item: null })}><Plus size={15} aria-hidden="true" />Card</Button><Button size="compact" variant="outline" onClick={() => setEditor({ kind: "identity", item: null })}><Plus size={15} aria-hidden="true" />Identity</Button></div> : null}
        </div>
      )}
    </section>
  );
}

function Generator({ onLock }: { onLock: () => void }) {
  const [length, setLength] = useState(20);
  const [password, setPassword] = useState(() => generatePassword({ length: 20 }));
  const [copyStatus, setCopyStatus] = useState("");
  const regenerate = () => {
    setPassword(generatePassword({ length }));
    setCopyStatus("");
  };
  const copy = async () => {
    setCopyStatus("");
    const response = await send({ type: "COPY_SECRET", value: password });
    if (response.ok && "copied" in response) {
      setCopyStatus(`Copied. Clears in ${response.clearAfterSeconds} seconds.`);
    } else if (!response.ok && response.error === "LOCKED") {
      onLock();
    } else {
      setCopyStatus("Clipboard access failed.");
    }
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
            onClick={() => void copy()}
          >
            <Copy size={14} aria-hidden="true" />{copyStatus.startsWith("Copied") ? "Copied" : "Copy"}
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
        onChange={(event) => { setLength(Number(event.target.value)); setCopyStatus(""); }}
        onPointerUp={regenerate}
        onKeyUp={regenerate}
      />
      <p aria-live="polite" className="mt-6 text-xs leading-5 text-muted-foreground">
        {copyStatus || "Generated locally with rejection-sampled cryptographic randomness."}
      </p>
    </section>
  );
}

function SettingsPanel({ onLock, onLegal }: { onLock: () => void; onLegal: (kind: LegalDocumentKind, triggerId: string) => void }) {
  const [settings, setSettings] = useState<PublicSecuritySettings | null>(null);
  const [autoLockMinutes, setAutoLockMinutes] = useState(5);
  const [clearClipboardSeconds, setClearClipboardSeconds] = useState(30);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void send({ type: "GET_SECURITY_SETTINGS" }).then((response) => {
      if (response.ok && "settings" in response) {
        setSettings(response.settings);
        setAutoLockMinutes(response.settings.autoLockMinutes);
        setClearClipboardSeconds(response.settings.clearClipboardSeconds);
      } else if (!response.ok && response.error === "LOCKED") {
        onLock();
      } else {
        setStatus("Settings could not be loaded.");
      }
    });
  }, [onLock]);

  const save = async () => {
    setSaving(true);
    setStatus("");
    try {
      const response = await send({
        type: "UPDATE_SECURITY_SETTINGS",
        settings: { autoLockMinutes, clearClipboardSeconds },
      });
      if (response.ok && "settings" in response) {
        setSettings(response.settings);
        setStatus("Session safety settings saved.");
      } else if (!response.ok && response.error === "LOCKED") {
        onLock();
      } else {
        setStatus("Settings could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="px-5 py-6" aria-labelledby="settings-title">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brass">Control room</p>
      <h2 id="settings-title" className="mt-2 font-display text-3xl">Settings</h2>
      <div className="mt-7 space-y-5 border-y border-line py-5">
        <label className="block text-sm font-semibold" htmlFor="auto-lock-minutes">
          Auto-lock after inactivity
        </label>
        <select
          id="auto-lock-minutes"
          className="min-h-11 w-full border border-line bg-field px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={autoLockMinutes}
          disabled={!settings || saving}
          onChange={(event) => { setAutoLockMinutes(Number(event.target.value)); setStatus(""); }}
        >
          {[1, 5, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minute{minutes === 1 ? "" : "s"}</option>)}
        </select>
        <label className="block text-sm font-semibold" htmlFor="clipboard-clear-seconds">
          Clear copied passwords after
        </label>
        <select
          id="clipboard-clear-seconds"
          className="min-h-11 w-full border border-line bg-field px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={clearClipboardSeconds}
          disabled={!settings || saving}
          onChange={(event) => { setClearClipboardSeconds(Number(event.target.value)); setStatus(""); }}
        >
          {[15, 30, 60, 120].map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
        </select>
        <Button className="w-full" disabled={!settings || saving} onClick={() => void save()}>
          <Save size={15} aria-hidden="true" />{saving ? "Saving…" : "Save session settings"}
        </Button>
        <p aria-live="polite" className="min-h-5 text-xs leading-5 text-muted-foreground">{status}</p>
      </div>
      <div className="mt-6 flex items-center justify-between border-b border-line pb-4">
        <span className="text-sm font-semibold">Google Drive</span>
        <span className="text-sm text-muted-foreground">Not connected</span>
      </div>
      <Button className="mt-4 w-full" variant="outline"><ShieldCheck size={16} aria-hidden="true" />Connect Google Drive</Button>
      <div className="mt-6">
        <LegalLinks idPrefix="settings" onOpen={onLegal} />
      </div>
    </section>
  );
}

function UnlockedView({ onLock, onLegal }: { onLock: () => void; onLegal: (kind: LegalDocumentKind, triggerId: string) => void }) {
  const [items, setItems] = useState<PublicVaultItem[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    void send({ type: "LIST_ITEMS" }).then((response) => {
      if (response.ok && "items" in response) setItems(response.items);
      else if (!response.ok && response.error === "LOCKED") onLock();
    });
  }, [onLock, refreshKey]);

  const lastActivityTouch = useRef(0);
  useEffect(() => {
    const recordActivity = () => {
      const now = performance.now();
      if (now - lastActivityTouch.current < 10_000) return;
      lastActivityTouch.current = now;
      void send({ type: "TOUCH_SESSION" }).then((response) => {
        if (!response.ok && response.error === "LOCKED") onLock();
      });
    };
    window.addEventListener("pointerdown", recordActivity);
    window.addEventListener("keydown", recordActivity);
    return () => {
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("keydown", recordActivity);
    };
  }, [onLock]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void send({ type: "STATUS" }).then((response) => {
        if (!response.ok || !("status" in response) || response.status !== "unlocked") onLock();
      });
    }, 5_000);
    return () => window.clearInterval(interval);
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
        <TabsContent value="vault"><SiteMatches refreshKey={refreshKey} /><VaultList items={items} onChanged={() => setRefreshKey((value) => value + 1)} /></TabsContent>
        <TabsContent value="generator"><Generator onLock={onLock} /></TabsContent>
        <TabsContent value="settings"><SettingsPanel onLock={onLock} onLegal={onLegal} /></TabsContent>
      </Tabs>
    </main>
  );
}

export function App() {
  const [view, setView] = useState<ViewState>("loading");
  const [legalDocument, setLegalDocument] = useState<LegalDocumentKind | null>(null);
  const legalTriggerId = useRef<string | null>(null);
  const showLocked = useCallback(() => setView("locked"), []);
  const openLegal = useCallback((kind: LegalDocumentKind, triggerId: string) => {
    legalTriggerId.current = triggerId;
    setLegalDocument(kind);
  }, []);
  const closeLegal = useCallback(() => {
    const triggerId = legalTriggerId.current;
    setLegalDocument(null);
    window.requestAnimationFrame(() => {
      if (triggerId) document.getElementById(triggerId)?.focus();
    });
  }, []);
  useEffect(() => {
    void send({ type: "STATUS" }).then((response) => {
      setView(response.ok && "status" in response ? response.status : "locked");
    });
  }, []);
  if (legalDocument) return <LegalDocumentView kind={legalDocument} onBack={closeLegal} />;
  if (view === "loading") return <LoadingView />;
  if (view === "empty" || view === "locked") return <GateView mode={view} onOpen={() => setView("unlocked")} onLegal={openLegal} />;
  return <UnlockedView onLock={showLocked} onLegal={openLegal} />;
}
