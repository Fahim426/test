import { useQuery } from '@tanstack/react-query';
import { getScreen } from '@/screens/registry';
import { useProductConfig, screenEnabled } from '@/hooks/useProductConfig';
import { useEffect, useRef, useState } from 'react';
import {
  MessageCircle,
  Send,
  Minus,
  Maximize2,
  Minimize2,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  X,
  LockKeyhole,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, hasPermission } from '@/store/auth';
import { useOpenScreen, useWorkspaceStore } from '@/store/workspace';
type Target = { label?: string; screenId: string; params?: Record<string, unknown>; highlight?: string };
type Reply = {
  intent: string | null;
  text: string;
  table?: {
    columns: { key: string; label: string; format?: 'money' | 'number' | 'date' }[];
    rows: Record<string, unknown>[];
    targets?: (Target | null)[];
  };
  link?: Target;
  chips?: string[];
  awaiting?: unknown;
  responseId?: string;
  answerType?: 'guide' | 'limitation';
  details?: { branch: string; period: string; filters: string[]; sources: string[]; calculation: string };
};
type Message = { id: string; role: 'user' | 'assistant'; text: string; reply?: Reply };
const welcome: Message = {
  id: 'welcome',
  role: 'assistant',
  text: 'Ask a complete question about permitted ERP data, or ask how a workflow works. Each question is independent: include the product, branch and period you need. I only read records; I never create, post or send anything.',
};
const iconStyle = {
  width: 30,
  height: 30,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: 'inherit',
} as const;
const chipStyle = {
  border: '1px solid #c7d2fe',
  background: '#eef2ff',
  color: '#3730a3',
  borderRadius: 12,
  padding: '5px 9px',
  fontSize: 11,
  cursor: 'pointer',
  textAlign: 'left' as const,
};
export default function AssistantChat() {
  const { config } = useProductConfig();
  const token = useAuth((s) => s.accessToken),
    user = useAuth((s) => s.user),
    openScreen = useOpenScreen();
  const identity = user ? [user.id, user.branchId ?? '', ...user.permissions.slice().sort()].join('|') : '';
  const [open, setOpen] = useState(false),
    [wide, setWide] = useState(false),
    [messages, setMessages] = useState<Message[]>([welcome]),
    [input, setInput] = useState(''),
    [busy, setBusy] = useState(false),
    [votes, setVotes] = useState<Record<string, string>>({}),
    [feedbackError, setFeedbackError] = useState('');
  const awaiting = useRef<unknown>(),
    generation = useRef(0),
    pending = useRef(false),
    controller = useRef<AbortController>(),
    inputRef = useRef<HTMLInputElement>(null),
    bottom = useRef<HTMLDivElement>(null),
    launcher = useRef<HTMLButtonElement>(null);
  const screenId = useWorkspaceStore((s) => s.tabs.find((t) => t.id === s.activeId)?.screenId ?? '');
  const suggested = useQuery({
    queryKey: ['assistant-suggestions', identity, screenId, JSON.stringify(config.features)],
    enabled: open && !!token && config.features.assistant,
    queryFn: async ({ signal }) =>
      (await api.post<Reply>('/assistant/message', { message: 'help', context: { screenId } }, { signal })).data,
    staleTime: 60000,
    gcTime: 60000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const reset = () => {
    generation.current++;
    controller.current?.abort();
    pending.current = false;
    awaiting.current = undefined;
    setBusy(false);
    setMessages([welcome]);
    setInput('');
    setVotes({});
    setFeedbackError('');
  };
  useEffect(() => {
    reset();
    setOpen(false);
    return () => controller.current?.abort();
  }, [identity]); // Clear private history whenever user, permissions or branch changes.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      bottom.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [open, messages, busy]);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        launcher.current?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open]);
  const submit = async (value: string) => {
    const message = value.trim();
    if (!message || pending.current || message.length > 1200) return;
    pending.current = true;
    setBusy(true);
    setInput('');
    const version = generation.current;
    controller.current = new AbortController();
    setMessages((old) => [...old.slice(-48), { id: crypto.randomUUID(), role: 'user', text: message }]);
    try {
      const res = await api.post<Reply>(
        '/assistant/message',
        { message, context: { screenId, ...(awaiting.current ? { awaiting: awaiting.current } : {}) } },
        { signal: controller.current.signal },
      );
      if (version !== generation.current) return;
      const reply = res.data;
      awaiting.current = reply.awaiting;
      setMessages((old) => [
        ...old,
        { id: reply.responseId || crypto.randomUUID(), role: 'assistant', text: reply.text, reply },
      ]);
    } catch (error) {
      if (version !== generation.current) return;
      const err = error as { response?: { status?: number; data?: { text?: string; error?: string } } };
      if (err.response?.status === 400) {
        awaiting.current = undefined;
      }
      const text =
        err.response?.data?.text || err.response?.data?.error || 'The assistant could not connect. Please try again.';
      setMessages((old) => [...old, { id: crypto.randomUUID(), role: 'assistant', text }]);
    } finally {
      if (version === generation.current) {
        pending.current = false;
        setBusy(false);
        inputRef.current?.focus();
      }
    }
  };
  const navigate = (target: Target) => {
    const definition = getScreen(target.screenId);
    const permission = definition?.permission?.split(':');
    if (
      !definition ||
      !screenEnabled(target.screenId, config.features) ||
      (permission && !hasPermission(user?.permissions, permission[0], permission[1] || 'view'))
    ) {
      setFeedbackError('That screen is not available with your current access.');
      return;
    }
    openScreen(target.screenId, target.params, target.label);
    setOpen(false);
    if (!target.highlight) return;
    const highlight = target.highlight;
    let tries = 0;
    const locate = () => {
      const elements = [...document.querySelectorAll<HTMLElement>('tbody tr,input,h1,h2')];
      const match =
        elements.find(
          (el) =>
            el.getClientRects().length &&
            ((el instanceof HTMLInputElement ? el.value : el.innerText) || '').includes(highlight),
        ) ??
        [...document.querySelectorAll<HTMLElement>('h1 span,h1 + span')].find(
          (el) => el.getClientRects().length && el.innerText.trim() === highlight,
        );
      if (match) {
        match.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prior = match.style.outline;
        match.style.outline = '2px solid #6366f1';
        match.style.outlineOffset = '2px';
        setTimeout(() => {
          match.style.outline = prior;
          match.style.outlineOffset = '';
        }, 3500);
      } else if (++tries < 12) setTimeout(locate, 200);
    };
    setTimeout(locate, 150);
  };
  const feedback = async (reply: Reply, rating: 'up' | 'down') => {
    if (!reply.responseId) return;
    setFeedbackError('');
    try {
      await api.post('/assistant/message', {
        message: '',
        context: { feedback: { responseId: reply.responseId, rating } },
      });
      setVotes((old) => ({ ...old, [reply.responseId!]: rating }));
    } catch {
      setFeedbackError('Feedback could not be saved. Please try again later.');
    }
  };
  const display = (value: unknown, format?: string) => {
    if (value === null || value === undefined || value === '') return '-';
    if (format === 'money' || format === 'number') {
      const n = Number(value);
      return Number.isFinite(n)
        ? n.toLocaleString('en-AE', {
            minimumFractionDigits: format === 'money' ? 2 : 0,
            maximumFractionDigits: format === 'money' ? 2 : 3,
          })
        : String(value);
    }
    if (format === 'date') return String(value).slice(0, 10);
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  };
  if (!token || !config.features.assistant) return null;
  return (
    <>
      {!open && (
        <button
          ref={launcher}
          type="button"
          onClick={() => setOpen(true)}
          data-tour="assistant"
          aria-label="Open ERP assistant"
          title="Ask the ERP assistant"
          style={{
            position: 'fixed',
            right: 22,
            bottom: 48,
            zIndex: 75,
            width: 52,
            height: 52,
            border: 0,
            borderRadius: 26,
            background: '#4f46e5',
            color: '#fff',
            boxShadow: '0 5px 20px #312e8140',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MessageCircle size={24} />
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-label="ERP assistant"
          aria-modal="false"
          style={{
            position: 'fixed',
            right: wide ? 16 : 22,
            bottom: wide ? 16 : 48,
            zIndex: 80,
            width: wide ? 'min(1050px, calc(100vw - 32px))' : 'min(455px, calc(100vw - 32px))',
            height: wide ? 'calc(100vh - 32px)' : 'min(650px, calc(100vh - 96px))',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: 14,
            border: '1px solid #cbd5e1',
            background: '#fff',
            color: '#0f172a',
            boxShadow: '0 15px 60px #0f172a30',
            fontFamily: 'inherit',
            fontSize: 13,
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '11px 12px',
              background: '#4f46e5',
              color: '#fff',
            }}
          >
            <MessageCircle size={20} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 14 }}>{config.appName} Assistant</strong>
              <div style={{ fontSize: 10, opacity: 0.85, display: 'flex', alignItems: 'center', gap: 4 }}>
                <LockKeyhole size={10} />
                Read-only · Each question stands alone
              </div>
            </div>
            <button
              type="button"
              style={iconStyle}
              disabled={busy}
              aria-label="Start new assistant conversation"
              title="New conversation"
              onClick={reset}
            >
              <RotateCcw size={15} />
            </button>
            <button
              type="button"
              style={iconStyle}
              aria-label={wide ? 'Restore assistant size' : 'Maximise assistant'}
              onClick={() => setWide((v) => !v)}
            >
              {wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button type="button" style={iconStyle} aria-label="Minimise assistant" onClick={() => setOpen(false)}>
              <Minus size={17} />
            </button>
            <button type="button" style={iconStyle} aria-label="Close assistant" onClick={() => setOpen(false)}>
              <X size={17} />
            </button>
          </header>
          <div style={{ flex: 1, overflowY: 'auto', padding: 13, background: '#f8fafc' }} aria-live="polite">
            {!!suggested.data?.chips?.length && (
              <aside aria-label="Suggested questions" style={{ marginBottom: 12 }}>
                <p style={{ margin: '0 0 7px', fontSize: 11, color: '#64748b' }}>
                  Suggested for {getScreen(screenId)?.title || 'your workspace'}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {suggested.data.chips.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      style={chipStyle}
                      disabled={busy}
                      onClick={() => {
                        awaiting.current = undefined;
                        void submit(chip);
                      }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </aside>
            )}
            {suggested.isError && (
              <p style={{ fontSize: 11, color: '#64748b' }}>
                Suggestions could not load. You can still ask a complete question.
              </p>
            )}
            {messages.map((m) => (
              <article
                key={m.id}
                style={{
                  marginBottom: 13,
                  marginLeft: m.role === 'user' ? 32 : 0,
                  marginRight: m.role === 'user' ? 0 : 12,
                  padding: '10px 11px',
                  borderRadius: 10,
                  background: m.role === 'user' ? '#e0e7ff' : '#fff',
                  border: '1px solid ' + (m.role === 'user' ? '#c7d2fe' : '#e2e8f0'),
                }}
              >
                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>
                  {m.role === 'user' ? 'You' : config.appName + ' Assistant'}
                </div>
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0, lineHeight: 1.55 }}>
                  {m.text}
                </p>
                {m.reply?.details && (
                  <aside
                    aria-label="Answer scope and sources"
                    style={{
                      marginTop: 9,
                      padding: 9,
                      borderRadius: 7,
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      fontSize: 11,
                      color: '#475569',
                      lineHeight: 1.6,
                    }}
                  >
                    <div>
                      <strong>Branch:</strong> {m.reply.details.branch}
                    </div>
                    <div>
                      <strong>Period:</strong> {m.reply.details.period}
                    </div>
                    {!!m.reply.details.filters.length && (
                      <div>
                        <strong>Filters:</strong> {m.reply.details.filters.join('; ')}
                      </div>
                    )}
                    <div>
                      <strong>Source:</strong> {m.reply.details.sources.join('; ')}
                    </div>
                    <div>
                      <strong>Basis:</strong> {m.reply.details.calculation}
                    </div>
                  </aside>
                )}
                {m.reply?.table && (
                  <div
                    style={{
                      maxHeight: 270,
                      overflow: 'auto',
                      marginTop: 10,
                      border: '1px solid #e2e8f0',
                      borderRadius: 6,
                    }}
                  >
                    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
                      <thead>
                        <tr>
                          {m.reply.table.columns.map((c) => (
                            <th
                              key={c.key}
                              style={{
                                padding: '7px 8px',
                                textAlign: 'left',
                                background: '#eef2ff',
                                whiteSpace: 'nowrap',
                                position: 'sticky',
                                top: 0,
                              }}
                            >
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {m.reply.table.rows.map((row, i) => {
                          const target = m.reply?.table?.targets?.[i];
                          return (
                            <tr
                              key={i}
                              onClick={() => target && navigate(target)}
                              onKeyDown={(event) => {
                                if (target && (event.key === 'Enter' || event.key === ' ')) {
                                  event.preventDefault();
                                  navigate(target);
                                }
                              }}
                              tabIndex={target ? 0 : undefined}
                              aria-label={
                                target ? 'Open record ' + (target.highlight || target.label || i + 1) : undefined
                              }
                              style={{ cursor: target ? 'pointer' : 'default', background: i % 2 ? '#f8fafc' : '#fff' }}
                            >
                              {m.reply!.table!.columns.map((c) => {
                                const value = display(row[c.key], c.format);
                                return (
                                  <td
                                    key={c.key}
                                    title={value}
                                    style={{
                                      padding: '7px 8px',
                                      borderTop: '1px solid #e2e8f0',
                                      minWidth: 70,
                                      maxWidth: 260,
                                      overflowWrap: 'anywhere',
                                      verticalAlign: 'top',
                                    }}
                                  >
                                    {value.length > 350 ? value.slice(0, 350) + '…' : value}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {!m.reply.table.rows.length && <p style={{ padding: 10, color: '#64748b' }}>No matching rows.</p>}
                  </div>
                )}
                {m.reply?.link && (
                  <button type="button" style={{ ...chipStyle, marginTop: 9 }} onClick={() => navigate(m.reply!.link!)}>
                    {m.reply.link.label || 'Open related screen'} →
                  </button>
                )}
                {!!m.reply?.chips?.length && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 9 }}>
                    {m.reply.chips.map((chip, i) => (
                      <button key={i} type="button" style={chipStyle} disabled={busy} onClick={() => void submit(chip)}>
                        {chip}
                      </button>
                    ))}
                  </div>
                )}
                {m.reply?.responseId && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, color: '#64748b' }}>
                    <span style={{ fontSize: 10, marginRight: 4 }}>Helpful?</span>
                    <button
                      type="button"
                      aria-label="Helpful answer"
                      style={{
                        ...iconStyle,
                        width: 25,
                        height: 24,
                        color: votes[m.reply.responseId] === 'up' ? '#4f46e5' : '#64748b',
                      }}
                      disabled={!!votes[m.reply.responseId]}
                      onClick={() => void feedback(m.reply!, 'up')}
                    >
                      <ThumbsUp size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label="Unhelpful answer"
                      style={{
                        ...iconStyle,
                        width: 25,
                        height: 24,
                        color: votes[m.reply.responseId] === 'down' ? '#4f46e5' : '#64748b',
                      }}
                      disabled={!!votes[m.reply.responseId]}
                      onClick={() => void feedback(m.reply!, 'down')}
                    >
                      <ThumbsDown size={13} />
                    </button>
                    {!!votes[m.reply.responseId] && <span style={{ fontSize: 10 }}>Thanks</span>}
                  </div>
                )}
              </article>
            ))}
            {busy && (
              <div role="status" style={{ color: '#64748b', padding: 8 }}>
                Reading permitted ERP data…
              </div>
            )}
            {feedbackError && (
              <p role="alert" style={{ color: '#b91c1c', fontSize: 11 }}>
                {feedbackError}
              </p>
            )}
            <div ref={bottom} />
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit(input);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: 11,
              borderTop: '1px solid #e2e8f0',
              background: '#fff',
            }}
          >
            <label htmlFor="erp-assistant-input" className="sr-only">
              Ask the ERP assistant
            </label>
            <input
              ref={inputRef}
              id="erp-assistant-input"
              name="assistant-message"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={1200}
              placeholder="Ask about sales, stock, dues…"
              autoComplete="off"
              style={{
                flex: 1,
                minWidth: 0,
                padding: '10px 11px',
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                background: '#fff',
                color: '#0f172a',
                outlineColor: '#6366f1',
              }}
            />
            <button
              type="submit"
              aria-label="Send assistant question"
              disabled={busy || !input.trim()}
              style={{
                ...iconStyle,
                width: 38,
                height: 38,
                background: '#4f46e5',
                color: '#fff',
                opacity: busy || !input.trim() ? 0.5 : 1,
              }}
            >
              <Send size={17} />
            </button>
          </form>
        </section>
      )}
    </>
  );
}
