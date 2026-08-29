import { generatePassword } from "@ironkeep/shared";
import {
  ArrowLeft,
  Copy,
  CreditCard,
  FileText,
  Folder,
  Fingerprint,
  Heart,
  KeyRound,
  LockKeyhole,
  Plus,
  Save,
  Trash2,
  RefreshCw,
  Settings,
  Tag,
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
import type { ExtensionRequest, ExtensionResponse, PublicCreditCard, PublicCsvPreview, PublicIdentity, PublicLogin, PublicOrganization, PublicRestorePreview, PublicSecureNote, PublicSecuritySettings, PublicVaultItem } from "./runtime/types.js";

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

function VaultList({ items, organization, onChanged }: { items: PublicVaultItem[]; organization: PublicOrganization; onChanged: () => void }) {
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<VaultEditor | null>(null);
  const [organizing, setOrganizing] = useState<PublicVaultItem | null>(null);
  const [managingOrganization, setManagingOrganization] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [kindFilter, setKindFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const searchRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(
    () => items.filter((item) =>
      `${item.title} ${item.subtitle}`.toLowerCase().includes(deferredQuery) &&
      (kindFilter === "all" || item.kind === kindFilter) &&
      (categoryFilter === "all" || (categoryFilter === "none" ? !item.categoryId : item.categoryId === categoryFilter)) &&
      (tagFilter === "all" || item.tagIds.includes(tagFilter)),
    ),
    [categoryFilter, deferredQuery, items, kindFilter, tagFilter],
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

  useEffect(() => {
    if (categoryFilter !== "all" && categoryFilter !== "none" && !organization.categories.some((entry) => entry.id === categoryFilter)) setCategoryFilter("all");
    if (tagFilter !== "all" && !organization.tags.some((entry) => entry.id === tagFilter)) setTagFilter("all");
  }, [categoryFilter, organization, tagFilter]);

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

  function organize(item: PublicVaultItem) {
    setSelectedCategoryId(item.categoryId ?? "");
    setSelectedTagIds(item.tagIds);
    setOrganizing(item);
  }

  async function saveOrganization() {
    if (!organizing) return;
    const response = await send({
      type: "SET_ITEM_ORGANIZATION",
      itemId: organizing.id,
      ...(selectedCategoryId ? { categoryId: selectedCategoryId } : {}),
      tagIds: selectedTagIds,
    });
    if (response.ok) {
      setOrganizing(null);
      onChanged();
    }
  }

  if (editor?.kind === "login") return <LoginEditor item={editor.item} onCancel={() => setEditor(null)} onSaved={() => { setEditor(null); onChanged(); }} />;
  if (editor?.kind === "secureNote") return <SecureNoteEditor item={editor.item} onCancel={() => setEditor(null)} onSaved={() => { setEditor(null); onChanged(); }} />;
  if (editor?.kind === "creditCard") return <CreditCardEditor item={editor.item} onCancel={() => setEditor(null)} onSaved={() => { setEditor(null); onChanged(); }} />;
  if (editor?.kind === "identity") return <IdentityEditor item={editor.item} onCancel={() => setEditor(null)} onSaved={() => { setEditor(null); onChanged(); }} />;
  if (managingOrganization) return <OrganizationManager organization={organization} onBack={() => setManagingOrganization(false)} onChanged={onChanged} />;
  if (organizing) return (
    <section className="space-y-5 px-5 py-6" aria-labelledby="organize-title">
      <Button variant="ghost" size="compact" onClick={() => setOrganizing(null)}><ArrowLeft size={15} aria-hidden="true" />Back</Button>
      <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brass">Organization</p><h2 id="organize-title" className="mt-2 font-display text-3xl">{organizing.title}</h2></div>
      <FieldLabel label="Category">
        <select className="min-h-11 w-full border border-line bg-field px-3 text-sm" value={selectedCategoryId} onChange={(event) => setSelectedCategoryId(event.target.value)}>
          <option value="">No category</option>
          {organization.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </FieldLabel>
      <fieldset className="space-y-2"><legend className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Tags</legend>
        {organization.tags.length ? organization.tags.map((tag) => (
          <label key={tag.id} className="flex min-h-11 items-center gap-3 border border-line px-3 text-sm">
            <input type="checkbox" checked={selectedTagIds.includes(tag.id)} onChange={(event) => setSelectedTagIds((current) => event.target.checked ? [...current, tag.id] : current.filter((id) => id !== tag.id))} />{tag.name}
          </label>
        )) : <p className="text-xs text-muted-foreground">Create tags from Manage categories & tags first.</p>}
      </fieldset>
      <Button className="w-full" onClick={() => void saveOrganization()}><Save size={15} aria-hidden="true" />Save organization</Button>
    </section>
  );

  return (
    <section aria-label="Vault items">
      <div className="space-y-2 border-b border-line px-4 py-4">
        <SearchInput ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vault…" />
        <div className="grid grid-cols-3 gap-2">
          <select aria-label="Filter by item type" className="min-h-10 border border-line bg-field px-2 text-xs" value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}><option value="all">All types</option><option value="login">Logins</option><option value="secureNote">Notes</option><option value="creditCard">Cards</option><option value="identity">IDs</option></select>
          <select aria-label="Filter by category" className="min-h-10 border border-line bg-field px-2 text-xs" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">All categories</option><option value="none">No category</option>{organization.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
          <select aria-label="Filter by tag" className="min-h-10 border border-line bg-field px-2 text-xs" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="all">All tags</option>{organization.tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>
        </div>
        <Button className="w-full" size="compact" variant="ghost" onClick={() => setManagingOrganization(true)}><Folder size={15} aria-hidden="true" />Manage categories & tags</Button>
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
              <div className="group grid w-full grid-cols-[1fr_48px_48px] items-center transition-colors hover:bg-subtle">
                <button onClick={() => void edit(item)} className="grid cursor-pointer grid-cols-[40px_1fr] items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <span className="grid h-10 w-10 place-items-center border border-line bg-field text-brass">{itemIcon(item.kind)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">{item.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.subtitle}</span>
                    {item.categoryId || item.tagIds.length ? <span className="mt-1 block truncate text-[10px] text-brass">{[organization.categories.find((entry) => entry.id === item.categoryId)?.name, ...item.tagIds.map((id) => organization.tags.find((entry) => entry.id === id)?.name)].filter(Boolean).join(" · ")}</span> : null}
                  </span>
                </button>
                {item.kind === "login" || item.kind === "secureNote" || item.kind === "creditCard" || item.kind === "identity" ? (
                  <button type="button" onClick={() => void toggle(item)} aria-label={item.favorite ? `Remove ${item.title} from favorites` : `Add ${item.title} to favorites`} className="grid h-12 w-12 place-items-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <Heart size={16} fill={item.favorite ? "currentColor" : "none"} aria-hidden="true" />
                  </button>
                ) : <span aria-hidden="true" />}
                <button type="button" onClick={() => organize(item)} aria-label={`Organize ${item.title}`} className="grid h-12 w-12 place-items-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><Tag size={16} aria-hidden="true" /></button>
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

function SettingsPanel({ onLock, onLegal, onVaultChanged }: { onLock: () => void; onLegal: (kind: LegalDocumentKind, triggerId: string) => void; onVaultChanged: () => void }) {
  const [settings, setSettings] = useState<PublicSecuritySettings | null>(null);
  const [autoLockMinutes, setAutoLockMinutes] = useState(5);
  const [clearClipboardSeconds, setClearClipboardSeconds] = useState(30);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [currentMasterPassword, setCurrentMasterPassword] = useState("");
  const [newMasterPassword, setNewMasterPassword] = useState("");
  const [confirmMasterPassword, setConfirmMasterPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [restoreFileName, setRestoreFileName] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [restorePreview, setRestorePreview] = useState<PublicRestorePreview | null>(null);
  const [backupStatus, setBackupStatus] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("");
  const [deletingVault, setDeletingVault] = useState(false);
  const [csvPreview, setCsvPreview] = useState<PublicCsvPreview | null>(null);
  const [csvStatus, setCsvStatus] = useState("");
  const [csvBusy, setCsvBusy] = useState(false);
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const [csvExportPassword, setCsvExportPassword] = useState("");

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

  const changeMasterPassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordStatus("");
    if (newMasterPassword.length < 12) {
      setPasswordStatus("New master password must be at least 12 characters.");
      return;
    }
    if (newMasterPassword !== confirmMasterPassword) {
      setPasswordStatus("New master passwords do not match.");
      return;
    }
    if (currentMasterPassword === newMasterPassword) {
      setPasswordStatus("Choose a different master password.");
      return;
    }
    setChangingPassword(true);
    try {
      const response = await send({ type: "CHANGE_MASTER_PASSWORD", currentMasterPassword, newMasterPassword });
      if (response.ok) {
        setCurrentMasterPassword("");
        setNewMasterPassword("");
        setConfirmMasterPassword("");
        setPasswordStatus("Master password changed. Existing vault data was re-encrypted locally.");
      } else if (response.error === "AUTHENTICATION_FAILED") {
        setPasswordStatus("Current master password was not accepted.");
      } else if (response.error === "LOCKED") {
        onLock();
      } else {
        setPasswordStatus("Master password could not be changed. The previous password still works.");
      }
    } finally {
      setChangingPassword(false);
    }
  };

  const exportEncryptedBackup = async () => {
    setBackupBusy(true);
    setBackupStatus("");
    try {
      const response = await send({ type: "EXPORT_ENCRYPTED_BACKUP" });
      if (response.ok && "backup" in response) {
        const url = URL.createObjectURL(new Blob([response.backup], { type: "application/vnd.ironkeep.vault" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = response.fileName;
        link.click();
        URL.revokeObjectURL(url);
        setBackupStatus("Encrypted backup created.");
      } else if (!response.ok && response.error === "LOCKED") onLock();
      else setBackupStatus("Encrypted backup could not be created.");
    } finally {
      setBackupBusy(false);
    }
  };

  const chooseRestoreFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setRestorePreview(null);
    setRestorePassword("");
    if (!file) return;
    if (file.size === 0 || file.size > 64 * 1024 * 1024) {
      setBackupStatus("Backup must be between 1 byte and 64 MiB.");
      return;
    }
    setBackupBusy(true);
    try {
      setRestoreText(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()));
      setRestoreFileName(file.name);
      setBackupStatus("Enter this backup's master password to validate it locally.");
    } catch {
      setBackupStatus("Backup file could not be read.");
    } finally {
      setBackupBusy(false);
    }
  };

  const previewRestore = async (event: FormEvent) => {
    event.preventDefault();
    setBackupBusy(true);
    setBackupStatus("");
    try {
      const response = await send({ type: "PREVIEW_ENCRYPTED_RESTORE", serializedVault: restoreText, masterPassword: restorePassword });
      setRestorePassword("");
      if (response.ok && "restorePreview" in response) {
        setRestorePreview(response.restorePreview);
        setBackupStatus("Backup authenticated. Review details before replacing the local vault.");
      } else if (!response.ok && response.error === "AUTHENTICATION_FAILED") {
        setBackupStatus("Master password was not accepted for this backup.");
      } else if (!response.ok && response.error === "LOCKED") onLock();
      else setBackupStatus("Backup is malformed or unsupported.");
    } finally {
      setBackupBusy(false);
    }
  };

  const cancelRestore = async () => {
    await send({ type: "CANCEL_ENCRYPTED_RESTORE" });
    setRestoreText("");
    setRestoreFileName("");
    setRestorePassword("");
    setRestorePreview(null);
    setBackupStatus("");
  };

  const confirmRestore = async () => {
    if (!restorePreview) return;
    setBackupBusy(true);
    try {
      const response = await send({ type: "CONFIRM_ENCRYPTED_RESTORE", token: restorePreview.token });
      if (response.ok) {
        setRestoreText("");
        setRestoreFileName("");
        setRestorePreview(null);
        setBackupStatus("Backup restored. The previous encrypted vault is stored as a recovery snapshot.");
        onVaultChanged();
      } else if (!response.ok && response.error === "LOCKED") onLock();
      else setBackupStatus("Restore failed. The current vault is unchanged.");
    } finally {
      setBackupBusy(false);
    }
  };

  const deleteLocalVault = async (event: FormEvent) => {
    event.preventDefault();
    if (deleteConfirmation !== "DELETE") {
      setDeleteStatus("Type DELETE to confirm.");
      return;
    }
    setDeletingVault(true);
    setDeleteStatus("");
    try {
      const response = await send({ type: "DELETE_LOCAL_VAULT", masterPassword: deletePassword, confirmation: deleteConfirmation });
      if (response.ok) {
        setDeletePassword("");
        setDeleteConfirmation("");
        onLock();
      } else if (response.error === "AUTHENTICATION_FAILED") {
        setDeleteStatus("Master password was not accepted. Vault was not deleted.");
      } else {
        setDeleteStatus("Vault could not be deleted. Local data is unchanged.");
      }
    } finally {
      setDeletingVault(false);
    }
  };

  const exportCsv = async () => {
    setCsvBusy(true);
    setCsvStatus("");
    try {
      const response = await send({ type: "EXPORT_CSV", masterPassword: csvExportPassword });
      setCsvExportPassword("");
      if (response.ok && "csv" in response) {
        const url = URL.createObjectURL(new Blob([response.csv], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = response.fileName;
        link.click();
        URL.revokeObjectURL(url);
        setCsvStatus("Plaintext CSV exported. Store it securely and delete it when finished.");
      } else if (!response.ok && response.error === "AUTHENTICATION_FAILED") setCsvStatus("Master password was not accepted. CSV was not exported.");
      else if (!response.ok && response.error === "LOCKED") onLock();
      else setCsvStatus("CSV could not be exported.");
    } finally {
      setCsvBusy(false);
    }
  };

  const previewCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setCsvPreview(null);
    if (!file) return;
    if (file.size === 0 || file.size > 16 * 1024 * 1024) {
      setCsvStatus("CSV must be between 1 byte and 16 MiB.");
      return;
    }
    setCsvBusy(true);
    setCsvStatus("");
    try {
      const response = await send({ type: "PREVIEW_CSV_IMPORT", csv: await file.text() });
      if (response.ok && "csvPreview" in response) {
        setCsvPreview(response.csvPreview);
        setCsvStatus("Review the import counts and choose how to handle likely duplicates.");
      } else if (!response.ok && response.error === "LOCKED") onLock();
      else setCsvStatus("CSV is empty, malformed, unsupported, or contains no valid rows.");
    } finally {
      setCsvBusy(false);
    }
  };

  const cancelCsv = async () => {
    await send({ type: "CANCEL_CSV_IMPORT" });
    setCsvPreview(null);
    setCsvStatus("");
  };

  const confirmCsv = async (includeDuplicates: boolean) => {
    if (!csvPreview) return;
    setCsvBusy(true);
    try {
      const response = await send({ type: "CONFIRM_CSV_IMPORT", token: csvPreview.token, includeDuplicates });
      if (response.ok) {
        const imported = csvPreview.validRows - (includeDuplicates ? 0 : csvPreview.duplicateRows);
        setCsvPreview(null);
        setCsvStatus(`${imported} item${imported === 1 ? "" : "s"} imported into the encrypted vault.`);
        onVaultChanged();
      } else if (!response.ok && response.error === "LOCKED") onLock();
      else setCsvStatus("CSV import failed. The previous vault is intact.");
    } finally {
      setCsvBusy(false);
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
      <form className="mt-6 space-y-4 border-b border-line pb-6" onSubmit={(event) => void changeMasterPassword(event)}>
        <div>
          <h3 className="text-sm font-semibold">Change master password</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Rewraps and re-encrypts this local vault. Other devices and backups keep their existing password until updated separately.</p>
        </div>
        <PasswordInput
          id="current-master-password"
          label="Current master password"
          autoComplete="current-password"
          value={currentMasterPassword}
          disabled={changingPassword}
          onChange={(event) => { setCurrentMasterPassword(event.target.value); setPasswordStatus(""); }}
        />
        <PasswordInput
          id="new-master-password"
          label="New master password"
          helperText="Use at least 12 characters. Ironkeep cannot recover it."
          autoComplete="new-password"
          value={newMasterPassword}
          disabled={changingPassword}
          onChange={(event) => { setNewMasterPassword(event.target.value); setPasswordStatus(""); }}
        />
        <PasswordInput
          id="confirm-master-password"
          label="Confirm new master password"
          autoComplete="new-password"
          value={confirmMasterPassword}
          disabled={changingPassword}
          onChange={(event) => { setConfirmMasterPassword(event.target.value); setPasswordStatus(""); }}
        />
        <Button className="w-full" type="submit" disabled={changingPassword || !currentMasterPassword || !newMasterPassword || !confirmMasterPassword}>
          <KeyRound size={15} aria-hidden="true" />{changingPassword ? "Changing…" : "Change master password"}
        </Button>
        <p aria-live="polite" className="min-h-5 text-xs leading-5 text-muted-foreground">{passwordStatus}</p>
      </form>
      <div className="mt-6 space-y-4 border-b border-line pb-6">
        <div>
          <h3 className="text-sm font-semibold">Encrypted backups</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Export or restore a local encrypted .ikv snapshot. Restore authenticates before showing a preview.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" disabled={backupBusy} onClick={() => void exportEncryptedBackup()}>
            <Save size={15} aria-hidden="true" />Export
          </Button>
          <Button type="button" variant="outline" disabled={backupBusy} onClick={() => restoreFileInputRef.current?.click()}>
            <FileText size={15} aria-hidden="true" />Restore
          </Button>
        </div>
        <input ref={restoreFileInputRef} className="sr-only" type="file" accept=".ikv,application/json,application/octet-stream" onChange={(event) => void chooseRestoreFile(event)} />
        {restoreText && !restorePreview ? (
          <form className="space-y-3 border border-line p-3" onSubmit={(event) => void previewRestore(event)}>
            <p className="truncate text-xs font-semibold">{restoreFileName}</p>
            <PasswordInput
              id="restore-master-password"
              label="Backup master password"
              autoComplete="current-password"
              value={restorePassword}
              disabled={backupBusy}
              onChange={(event) => setRestorePassword(event.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button type="submit" disabled={backupBusy || !restorePassword}>Validate</Button>
              <Button type="button" variant="ghost" onClick={() => void cancelRestore()}>Cancel</Button>
            </div>
          </form>
        ) : null}
        {restorePreview ? (
          <div className="space-y-3 border border-line p-3 text-xs leading-5">
            <p className="font-semibold">Authenticated restore preview</p>
            <p>Revision {restorePreview.revision} · {restorePreview.itemCount} items</p>
            <p>{new Date(restorePreview.updatedAt).toLocaleString()}</p>
            <p className="break-all text-muted-foreground">SHA-256 {restorePreview.checksum}</p>
            <p>The current encrypted vault will be saved as a recovery snapshot first.</p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="danger" disabled={backupBusy} onClick={() => void confirmRestore()}>Restore</Button>
              <Button type="button" variant="ghost" disabled={backupBusy} onClick={() => void cancelRestore()}>Cancel</Button>
            </div>
          </div>
        ) : null}
        <p aria-live="polite" className="min-h-5 text-xs leading-5 text-muted-foreground">{backupStatus}</p>
      </div>
      <div className="mt-6 space-y-4 border-b border-line pb-6">
        <div>
          <h3 className="text-sm font-semibold">CSV transfer</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Imports Ironkeep CSV or common browser login CSV. CSV is plaintext and can expose secrets.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" disabled={csvBusy || !csvExportPassword} onClick={() => void exportCsv()}>Export CSV</Button>
          <Button type="button" variant="outline" disabled={csvBusy} onClick={() => csvFileInputRef.current?.click()}>Import CSV</Button>
        </div>
        <PasswordInput id="csv-export-password" label="Master password for export" autoComplete="current-password" value={csvExportPassword} disabled={csvBusy} onChange={(event) => { setCsvExportPassword(event.target.value); setCsvStatus(""); }} />
        <input ref={csvFileInputRef} className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => void previewCsv(event)} />
        {csvPreview ? (
          <div className="space-y-3 border border-line p-3 text-xs leading-5">
            <p className="font-semibold">CSV import preview</p>
            <p>{csvPreview.totalRows} rows · {csvPreview.validRows} valid · {csvPreview.duplicateRows} likely duplicates · {csvPreview.invalidRows} invalid</p>
            <Button className="w-full" type="button" disabled={csvBusy} onClick={() => void confirmCsv(false)}>Import and skip duplicates</Button>
            {csvPreview.duplicateRows > 0 ? <Button className="w-full" type="button" variant="outline" disabled={csvBusy} onClick={() => void confirmCsv(true)}>Import all rows</Button> : null}
            <Button className="w-full" type="button" variant="ghost" disabled={csvBusy} onClick={() => void cancelCsv()}>Cancel</Button>
          </div>
        ) : null}
        <p aria-live="polite" className="min-h-5 text-xs leading-5 text-muted-foreground">{csvStatus}</p>
      </div>
      <div className="mt-6">
        <LegalLinks idPrefix="settings" onOpen={onLegal} />
      </div>
      <form className="mt-6 space-y-4 border-t border-danger/60 pt-5" onSubmit={(event) => void deleteLocalVault(event)}>
        <div>
          <h3 className="text-sm font-semibold text-danger">Danger zone</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Permanently deletes this browser's encrypted vault and local recovery snapshot. Export a backup first if needed.</p>
        </div>
        <PasswordInput
          id="delete-vault-password"
          label="Master password"
          autoComplete="current-password"
          value={deletePassword}
          disabled={deletingVault}
          onChange={(event) => { setDeletePassword(event.target.value); setDeleteStatus(""); }}
        />
        <FieldLabel label="Type DELETE">
          <Input value={deleteConfirmation} disabled={deletingVault} onChange={(event) => { setDeleteConfirmation(event.target.value); setDeleteStatus(""); }} />
        </FieldLabel>
        <Button className="w-full" type="submit" variant="danger" disabled={deletingVault || !deletePassword || deleteConfirmation !== "DELETE"}>
          <Trash2 size={15} aria-hidden="true" />{deletingVault ? "Deleting…" : "Delete local vault"}
        </Button>
        <p aria-live="polite" className="min-h-5 text-xs leading-5 text-danger">{deleteStatus}</p>
      </form>
    </section>
  );
}

function UnlockedView({ onLock, onLegal }: { onLock: () => void; onLegal: (kind: LegalDocumentKind, triggerId: string) => void }) {
  const [items, setItems] = useState<PublicVaultItem[]>([]);
  const [organization, setOrganization] = useState<PublicOrganization>({ categories: [], tags: [] });
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    void send({ type: "LIST_ITEMS" }).then((response) => {
      if (response.ok && "items" in response) setItems(response.items);
      else if (!response.ok && response.error === "LOCKED") onLock();
    });
    void send({ type: "GET_ORGANIZATION" }).then((response) => {
      if (response.ok && "organization" in response) setOrganization(response.organization);
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
        <TabsContent value="vault"><SiteMatches refreshKey={refreshKey} /><VaultList items={items} organization={organization} onChanged={() => setRefreshKey((value) => value + 1)} /></TabsContent>
        <TabsContent value="generator"><Generator onLock={onLock} /></TabsContent>
        <TabsContent value="settings"><SettingsPanel onLock={onLock} onLegal={onLegal} onVaultChanged={() => setRefreshKey((value) => value + 1)} /></TabsContent>
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

function OrganizationManager({ organization, onBack, onChanged }: { organization: PublicOrganization; onBack: () => void; onChanged: () => void }) {
  const [categoryName, setCategoryName] = useState("");
  const [tagName, setTagName] = useState("");
  const [status, setStatus] = useState("");
  const mutate = async (request: ExtensionRequest) => {
    const response = await send(request);
    if (response.ok) { setStatus("Saved."); onChanged(); }
    else setStatus("Could not save. Names must be unique and 1–64 characters.");
  };
  return <section className="space-y-5 px-5 py-6" aria-labelledby="organization-title">
    <Button variant="ghost" size="compact" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />Back</Button>
    <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brass">Vault structure</p><h2 id="organization-title" className="mt-2 font-display text-3xl">Categories & tags</h2></div>
    <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (categoryName.trim()) void mutate({ type: "CREATE_CATEGORY", name: categoryName }).then(() => setCategoryName("")); }}><Input aria-label="New category name" placeholder="New category" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} /><Button type="submit" size="compact">Add</Button></form>
    <div className="space-y-2">{organization.categories.map((category) => <OrganizationRow key={category.id} value={category.name} onRename={(name) => mutate({ type: "RENAME_CATEGORY", categoryId: category.id, name })} onDelete={() => mutate({ type: "DELETE_CATEGORY", categoryId: category.id })} />)}</div>
    <form className="flex gap-2 border-t border-line pt-5" onSubmit={(event) => { event.preventDefault(); if (tagName.trim()) void mutate({ type: "CREATE_TAG", name: tagName }).then(() => setTagName("")); }}><Input aria-label="New tag name" placeholder="New tag" value={tagName} onChange={(event) => setTagName(event.target.value)} /><Button type="submit" size="compact">Add</Button></form>
    <div className="space-y-2">{organization.tags.map((tag) => <OrganizationRow key={tag.id} value={tag.name} onRename={(name) => mutate({ type: "RENAME_TAG", tagId: tag.id, name })} onDelete={() => mutate({ type: "DELETE_TAG", tagId: tag.id })} />)}</div>
    <p aria-live="polite" className="text-xs text-muted-foreground">{status}</p>
  </section>;
}

function OrganizationRow({ value, onRename, onDelete }: { value: string; onRename: (name: string) => Promise<void>; onDelete: () => Promise<void> }) {
  const [name, setName] = useState(value);
  useEffect(() => setName(value), [value]);
  return <div className="grid grid-cols-[1fr_auto_auto] gap-2"><Input aria-label={`Rename ${value}`} value={name} onChange={(event) => setName(event.target.value)} /><Button type="button" size="compact" variant="outline" onClick={() => void onRename(name)}>Save</Button><Button type="button" size="icon" variant="ghost" aria-label={`Delete ${value}`} onClick={() => { if (window.confirm(`Delete ${value}? Item data stays intact, but this assignment is removed.`)) void onDelete(); }}><Trash2 size={15} aria-hidden="true" /></Button></div>;
}
