import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Screen = "login" | "home" | "call" | "logs" | "settings";

const A = "/assets";

const icons = {
  logo: `${A}/6ad6e.svg`,
  home: `${A}/9720e.svg`,
  messages: `${A}/77ab3.svg`,
  settings: `${A}/2aa26.svg`,
  video: `${A}/f753b.svg`,
  mainAvatar: `${A}/3b269.svg`,
  selfAvatar: `${A}/17428.svg`,
  mic: `${A}/40559.svg`,
  camera: `${A}/8349a.svg`,
  chat: `${A}/844fe.svg`,
  phone: `${A}/6e3ae.svg`,
  shield: `${A}/84fe6.svg`,
  plus: `${A}/93dbe.svg`,
  send: `${A}/fd126.svg`,
};

function BottomNav({ screen, go }: { screen: Screen; go: (screen: Screen) => void }) {
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      <button className={screen === "home" ? "active" : ""} onClick={() => go("home")}>
        <img src={icons.home} alt="" /> Home
      </button>
      <button className={screen === "logs" ? "active" : ""} onClick={() => go("logs")}>
        <img src={icons.messages} alt="" /> Chat logs
      </button>
      <button className={screen === "settings" ? "active" : ""} onClick={() => go("settings")}>
        <img src={icons.settings} alt="" /> Settings
      </button>
    </nav>
  );
}

function FloatingMeeting({ openMeeting }: { openMeeting: () => void }) {
  return (
    <button
      className="floating-meeting"
      onClick={openMeeting}
      aria-label="Return to your meeting with Northy"
    >
      <span className="floating-meeting-live">
        <i />
        LIVE
      </span>
      <img src={icons.mainAvatar} alt="" />
      <span className="floating-meeting-caption">
        <strong>Northy</strong>
        <small>04:32</small>
      </span>
    </button>
  );
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <main className="loading-screen" aria-live="polite" aria-busy="true">
      <section className="loading-surface">
        <div className="loading-core">
          <h1>Noteworthy</h1>
          <p>{message}</p>
          <div className="page-loading-progress" aria-hidden="true">
            <span />
          </div>
        </div>
        <p className="loading-footer">Focused input from a video-aware AI.</p>
      </section>
    </main>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"login" | "create" | "reset">("login");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(normalizedEmail);

    setError("");
    setStatus("");

    if (!validEmail) {
      setError("Enter a valid email address.");
      return;
    }
    if (mode !== "reset" && password.length < 4) {
      setError("Enter at least 4 characters for your password.");
      return;
    }

    setLoading(true);
    await new Promise((resolve) => window.setTimeout(resolve, 1100));

    if (mode === "reset") {
      setLoading(false);
      setStatus(`Reset instructions sent to ${normalizedEmail}.`);
      return;
    }

    onLogin();
  }

  const loadingLabel =
    mode === "login"
      ? "Logging in…"
      : mode === "create"
        ? "Creating account…"
        : "Sending reset link…";

  const copy = {
    login: ["WELCOME BACK", "Good to see you.", "Log in to pick up where you left off."],
    create: [
      "YOUR SPACE AWAITS",
      "Create your account.",
      "Start a focused video conversation whenever you need input.",
    ],
    reset: [
      "RESET PASSWORD",
      "Let’s get you back.",
      "We’ll use your email to reset your password.",
    ],
  }[mode];

  return (
    <main className="login-screen">
      <section className="login-story" aria-label="About Noteworthy">
        <img className="story-photo" src={`${A}/42b91.png`} alt="Noteworthy AI assistant" />
        <div className="story-vignette" />
        <div className="story-brand">
          <span className="brand-mark">
            <img src={icons.logo} alt="" />
          </span>
          <strong>Noteworthy</strong>
        </div>
        <div className="story-copy">
          <span className="eyebrow dark">MEET NORTHY · YOUR AI</span>
          <h1>
            Suggestions
            <br />
            that work
          </h1>
          <p>
            Show Noteworthy what you’re working on or ask a direct question.
            <br />
            Your video-aware AI assistant is one call away.
          </p>
          <div className="story-promise">Practical input informed by what you choose to show</div>
        </div>
      </section>

      <section className="login-panel">
        <form className="login-form" key={mode} onSubmit={submit} noValidate>
          <span className="eyebrow">{copy[0]}</span>
          <h2>{copy[1]}</h2>
          <p className="subcopy">{copy[2]}</p>

          <div className="floating-field">
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError("");
              }}
              placeholder=" "
              autoComplete="email"
              aria-invalid={Boolean(error)}
              disabled={loading}
            />
            <label htmlFor="email">Email address</label>
          </div>

          {mode !== "reset" && (
            <>
              <div className="label-row">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setMode("reset");
                    setError("");
                    setStatus("");
                  }}
                  disabled={loading}
                >
                  Forgot password?
                </button>
              </div>
              <div className="floating-field password-field">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder=" "
                  autoComplete={mode === "create" ? "new-password" : "current-password"}
                  disabled={loading}
                />
                <label htmlFor="password">
                  {mode === "create" ? "Create password" : "Enter password"}
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  disabled={loading}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </>
          )}

          <div className="form-feedback" aria-live="polite">
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {status && <p className="form-status">{status}</p>}
          </div>
          {mode === "login" && (
            <button className="demo-button" type="button" onClick={onLogin} disabled={loading}>
              Skip for demo
            </button>
          )}
          <button className="primary login-submit" type="submit" disabled={loading}>
            {loading ? (
              <span className="loading-content">
                <i className="spinner" aria-hidden="true" /> {loadingLabel}
              </span>
            ) : (
              <>
                {mode === "login"
                  ? "Log in"
                  : mode === "create"
                    ? "Create account"
                    : "Send reset link"}
                <span className="button-arrow">→</span>
              </>
            )}
          </button>

          <div className="account-switch">
            {mode === "login" ? "New to Noteworthy?" : "Already have an account?"}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "create" : "login");
                setError("");
                setStatus("");
              }}
              disabled={loading}
            >
              {mode === "login" ? "Create an account" : "Log in"}
            </button>
          </div>
        </form>
        <footer className="login-footer">
          <button type="button">Terms of service</button>
          <button type="button">Privacy policy</button>
          <button type="button">Need help?</button>
        </footer>
      </section>
    </main>
  );
}

function Home({
  go,
  meetingActive,
  startCall,
}: {
  go: (screen: Screen) => void;
  meetingActive: boolean;
  startCall: () => void;
}) {
  const quotes = [
    {
      text: "The important thing is not to stop questioning.",
      author: "Albert Einstein",
    },
    {
      text: "What we see depends mainly on what we look for.",
      author: "John Lubbock",
    },
    {
      text: "Well done is better than well said.",
      author: "Benjamin Franklin",
    },
  ];
  const [quoteIndex, setQuoteIndex] = useState(0);
  const quote = quotes[quoteIndex];

  return (
    <main className="app-shell">
      <section className="workspace home-workspace">
        <div className="page-heading">
          <h1>Welcome back.</h1>
          <div className="home-quote">
            <p>
              “{quote.text}” <cite>— {quote.author}</cite>
            </p>
            <div className="quote-controls" aria-label="Browse quotes">
              <button
                onClick={() => setQuoteIndex((quoteIndex - 1 + quotes.length) % quotes.length)}
                aria-label="Previous quote"
              >
                ←
              </button>
              <span>
                {quoteIndex + 1}/{quotes.length}
              </span>
              <button
                onClick={() => setQuoteIndex((quoteIndex + 1) % quotes.length)}
                aria-label="Next quote"
              >
                →
              </button>
            </div>
          </div>
        </div>
        <div className="call-card">
          <span className="call-symbol">
            <img src={icons.video} alt="" />
          </span>
          <span className="eyebrow">VIDEO-AWARE AI</span>
          <h2>Call Noteworthy</h2>
          <p>
            Use your camera to show Noteworthy what you’re working on
            <br className="desktop-only" /> and get focused, real-time input.
          </p>
          <button className="primary call-button" onClick={startCall}>
            <img src={icons.video} alt="" /> Call AI
          </button>
        </div>
        <div className="home-notes">
          <p>
            Microphone and camera preferences are in{" "}
            <button onClick={() => go("settings")}>Settings</button>.
          </p>
        </div>
      </section>
      {meetingActive && <FloatingMeeting openMeeting={() => go("call")} />}
      <BottomNav screen="home" go={go} />
    </main>
  );
}

type Message = { from: "ai" | "you"; text: string; time: string };

const transcriptMessages: Message[] = [
  {
    from: "ai",
    text: "I’m online. What would you like me to take a look at?",
    time: "10:30",
  },
  {
    from: "you",
    text: "I’m working through this presentation and the structure feels unclear.",
    time: "10:31",
  },
  {
    from: "ai",
    text: "Show me the current draft and tell me who the audience is. We can review the structure first.",
    time: "10:31",
  },
];

const liveMessageQueue: Message[] = [
  {
    from: "you",
    text: "The presentation on Thursday. I know what I want to say, but I haven’t shaped the story yet.",
    time: "10:32",
  },
  {
    from: "ai",
    text: "That sounds like a good place to focus. What is the one idea you want everyone to remember?",
    time: "10:32",
  },
  {
    from: "you",
    text: "That small changes to the onboarding flow can make people feel much more confident.",
    time: "10:33",
  },
];

const callHistory = [
  {
    id: "weekly-reset",
    title: "Reviewing the weekly plan",
    date: "Yesterday",
    dayLabel: "YESTERDAY · 4:15 PM",
    duration: "12 min",
    messages: [
      {
        from: "you",
        text: "I want to verify that this plan is realistic before I share it.",
        time: "4:15",
      },
      {
        from: "ai",
        text: "Show me the milestones and deadlines. I’ll flag any scheduling conflicts.",
        time: "4:16",
      },
      {
        from: "you",
        text: "The first hour of each morning is reserved for focused project work.",
        time: "4:17",
      },
    ] as Message[],
  },
  {
    id: "presentation",
    title: "Finding the presentation story",
    date: "May 14",
    dayLabel: "MAY 14 · 10:30 AM",
    duration: "18 min",
    messages: [
      {
        from: "ai",
        text: "What is the one idea you want everyone to remember after the presentation?",
        time: "10:30",
      },
      {
        from: "you",
        text: "That small onboarding changes can make people feel much more confident.",
        time: "10:31",
      },
      {
        from: "ai",
        text: "That’s a strong center. We can let every example support that feeling of confidence.",
        time: "10:32",
      },
    ] as Message[],
  },
  {
    id: "check-in",
    title: "Quick afternoon check-in",
    date: "May 10",
    dayLabel: "MAY 10 · 2:05 PM",
    duration: "7 min",
    messages: [
      {
        from: "you",
        text: "I have twenty minutes and need help deciding what to do first.",
        time: "2:05",
      },
      {
        from: "ai",
        text: "Let’s pick the task that will make everything else feel lighter.",
        time: "2:06",
      },
    ] as Message[],
  },
];

function AudioLevels({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`levels ${compact ? "compact" : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

type MeetingControls = {
  muted: boolean;
  camera: boolean;
  transcriptOpen: boolean;
};

type MeetingControlProps = {
  controls: MeetingControls;
  updateControls: (updates: Partial<MeetingControls>) => void;
};

function Meeting({
  minimize,
  endMeeting,
  controls,
  updateControls,
}: {
  minimize: () => void;
  endMeeting: () => void;
} & MeetingControlProps) {
  const [ending, setEnding] = useState(false);

  async function endCall() {
    if (ending) return;
    setEnding(true);
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
    endMeeting();
  }

  return (
    <main className="call-screen meeting-screen">
      <div className={`call-layout ${controls.transcriptOpen ? "" : "chat-closed"}`}>
        <section className="video-stage">
          <div className="call-title">
            <h1>Northy</h1>
            <p>Connected · 04:32</p>
          </div>
          {controls.camera && (
            <div className="self-preview">
              <img src={icons.selfAvatar} alt="" />
              <span>You</span>
            </div>
          )}
          <img className="main-avatar" src={icons.mainAvatar} alt="Northy avatar" />
          <div className="speaking">
            <AudioLevels /> Northy is speaking
          </div>
          <blockquote>
            “I can see the draft.
            <br />
            Let’s review the opening slide first.”
          </blockquote>
          <div className="call-controls">
            <button onClick={minimize} aria-label="Minimize meeting and go home">
              <img src={icons.home} alt="" />
            </button>
            <button
              className={controls.muted ? "control-off" : ""}
              onClick={() => updateControls({ muted: !controls.muted })}
              aria-label={controls.muted ? "Unmute microphone" : "Mute microphone"}
              aria-pressed={controls.muted}
            >
              <img src={icons.mic} alt="" />
            </button>
            <button
              className={!controls.camera ? "control-off" : ""}
              onClick={() => updateControls({ camera: !controls.camera })}
              aria-label={controls.camera ? "Turn camera off" : "Turn camera on"}
              aria-pressed={!controls.camera}
            >
              <img src={icons.camera} alt="" />
            </button>
            <button
              className={controls.transcriptOpen ? "selected" : ""}
              onClick={() => updateControls({ transcriptOpen: !controls.transcriptOpen })}
              aria-label="Toggle live transcript"
              aria-pressed={controls.transcriptOpen}
            >
              <img src={icons.chat} alt="" />
            </button>
            <button className="end-call" onClick={endCall} disabled={ending}>
              {ending ? (
                <span className="loading-content">
                  <i className="spinner" aria-hidden="true" /> Ending…
                </span>
              ) : (
                <>
                  <img src={icons.phone} alt="" />
                  <span>End</span>
                </>
              )}
            </button>
          </div>
        </section>

        {controls.transcriptOpen && (
          <aside className="transcript">
            <div className="transcript-title">
              <div>
                <span className="meeting-live-dot" />
                <h2>Live transcript</h2>
              </div>
              <button aria-label="Open full chat logs" onClick={minimize}>
                •••
              </button>
            </div>
            <div className="private-banner">
              <img src={icons.shield} alt="" /> Secure and visible only to you
            </div>
            <div className="message-list">
              <time>TODAY · 10:30 AM</time>
              {transcriptMessages.map((message, index) => (
                <div className={`message ${message.from}`} key={`${message.from}-${index}`}>
                  <strong>{message.from === "ai" ? "Northy · AI" : "You"}</strong>
                  <p>{message.text}</p>
                </div>
              ))}
              <small>Northy is speaking…</small>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}

function ChatLogs({
  meetingActive,
  openMeeting,
  go,
}: {
  meetingActive: boolean;
  openMeeting: () => void;
  go: (screen: Screen) => void;
}) {
  const [capturing, setCapturing] = useState(true);
  const [messages, setMessages] = useState(transcriptMessages);
  const [selectedCallId, setSelectedCallId] = useState(meetingActive ? "live" : callHistory[0].id);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      !meetingActive ||
      !capturing ||
      messages.length >= transcriptMessages.length + liveMessageQueue.length
    )
      return;
    const timeout = window.setTimeout(() => {
      const nextMessage = liveMessageQueue[messages.length - transcriptMessages.length];
      setMessages((current) => [...current, nextMessage]);
    }, 4200);
    return () => window.clearTimeout(timeout);
  }, [capturing, meetingActive, messages.length]);

  useEffect(() => {
    if (selectedCallId === "live") {
      transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [messages.length, selectedCallId]);

  const selectedCall = callHistory.find((call) => call.id === selectedCallId);
  const selectedMessages = selectedCall?.messages ?? messages;
  const filteredMessages = selectedMessages.filter((message) =>
    message.text.toLowerCase().includes(query.trim().toLowerCase()),
  );

  async function copyTranscript() {
    const text = selectedMessages
      .map((message) => `${message.from === "ai" ? "Northy" : "You"}: ${message.text}`)
      .join("\n\n");
    await navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="call-screen live-logs-screen">
      <div className="logs-surface">
        <div className="logs-heading">
          <div>
            <span className="eyebrow">LIVE CONVERSATION</span>
            <h1>Chat logs</h1>
          </div>
          <div className="live-session-state">
            <span className={`live-dot ${capturing ? "" : "paused"}`} />
            <span>
              <strong>
                {meetingActive ? (capturing ? "Live capture on" : "Capture paused") : "Latest call"}
              </strong>
              <small>{meetingActive ? "Northy call · 04:32" : "Today · 10:30 AM"}</small>
            </span>
          </div>
        </div>

        <div className="live-logs-layout">
          <section className="live-transcript" aria-label="Live call transcript">
            <div className="transcript-toolbar">
              <div className="transcript-status">
                <span className="transcript-icon">
                  <img src={icons.chat} alt="" />
                </span>
                <span>
                  <strong>{selectedCall?.title ?? "Live transcript"}</strong>
                  <small>{selectedMessages.length} moments captured</small>
                </span>
              </div>
              <div className="transcript-actions">
                <label className="transcript-search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search transcript"
                    aria-label="Search transcript"
                  />
                </label>
                <button className="copy-button" onClick={copyTranscript}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="transcript-day">
              <span>{selectedCall?.dayLabel ?? "TODAY"}</span>
              <i />
            </div>

            <div className="live-message-list" aria-live="polite">
              {filteredMessages.length ? (
                filteredMessages.map((message, index) => (
                  <article
                    className={`live-message ${message.from}`}
                    key={`${message.time}-${index}`}
                  >
                    <div className="speaker-avatar">
                      {message.from === "ai" ? (
                        <img src={icons.mainAvatar} alt="" />
                      ) : (
                        <span>Y</span>
                      )}
                    </div>
                    <div className="message-content">
                      <div className="message-meta">
                        <strong>{message.from === "ai" ? "Northy" : "You"}</strong>
                        {message.from === "ai" && <span>AI ASSISTANT</span>}
                        <time>{message.time} AM</time>
                      </div>
                      <p>{message.text}</p>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-search">
                  <strong>No matching moments</strong>
                  <p>Try searching for another word or phrase.</p>
                </div>
              )}
              {selectedCallId === "live" && meetingActive && capturing && !query && (
                <div className="listening-row">
                  <AudioLevels compact />
                  <span>Listening for the next thought…</span>
                </div>
              )}
              <div ref={transcriptEnd} />
            </div>
          </section>

          <aside className="call-sidebar">
            <section className="call-history-card">
              <div className="history-heading">
                <div>
                  <span className="eyebrow">YOUR CONVERSATIONS</span>
                  <h2>Call history</h2>
                </div>
                <span>{callHistory.length + (meetingActive ? 1 : 0)}</span>
              </div>
              <div className="history-list">
                {meetingActive && (
                  <button
                    className={selectedCallId === "live" ? "active" : ""}
                    onClick={() => {
                      setSelectedCallId("live");
                      setQuery("");
                    }}
                  >
                    <span className="history-live-icon">
                      <i />
                    </span>
                    <span>
                      <strong>Current conversation</strong>
                      <small>Live now</small>
                    </span>
                    <span className="history-arrow">›</span>
                  </button>
                )}
                {callHistory.map((call) => (
                  <button
                    className={selectedCallId === call.id ? "active" : ""}
                    key={call.id}
                    onClick={() => {
                      setSelectedCallId(call.id);
                      setQuery("");
                    }}
                  >
                    <span className="history-date-icon">{call.date.slice(0, 1)}</span>
                    <span>
                      <strong>{call.title}</strong>
                      <small>
                        {call.date} · {call.duration}
                      </small>
                    </span>
                    <span className="history-arrow">›</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="capture-card">
              <div className="capture-card-heading">
                <span className="capture-icon">
                  <img src={icons.shield} alt="" />
                </span>
                <div>
                  <h3>Live capture</h3>
                  <p>Only you can see this transcript.</p>
                </div>
              </div>
              <button
                className={`capture-toggle ${capturing && meetingActive ? "active" : ""}`}
                onClick={() => setCapturing((value) => !value)}
                disabled={!meetingActive}
              >
                <span>
                  <i />
                </span>
                {!meetingActive
                  ? "Starts with your next call"
                  : capturing
                    ? "Pause capture"
                    : "Resume capture"}
              </button>
            </section>
          </aside>
        </div>
      </div>
      {meetingActive && <FloatingMeeting openMeeting={openMeeting} />}
      <BottomNav screen="logs" go={go} />
    </main>
  );
}

type Preferences = {
  microphone: string;
  speaker: string;
  camera: string;
  captions: boolean;
  transcripts: boolean;
  reminders: boolean;
};

const initialPreferences: Preferences = {
  microphone: "Default microphone",
  speaker: "System default",
  camera: "Default camera",
  captions: true,
  transcripts: false,
  reminders: false,
};

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "on" : ""}`}
      onClick={onChange}
    >
      <span />
    </button>
  );
}

function Settings({ go, meetingActive }: { go: (screen: Screen) => void; meetingActive: boolean }) {
  const [saved, setSaved] = useState(initialPreferences);
  const [prefs, setPrefs] = useState(initialPreferences);
  const [status, setStatus] = useState("");
  const changed = useMemo(() => JSON.stringify(saved) !== JSON.stringify(prefs), [saved, prefs]);

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPrefs((current) => ({ ...current, [key]: value }));
    setStatus("");
  }

  return (
    <main className="app-shell">
      <section className="workspace settings-workspace">
        <div className="page-heading">
          <h1>Settings</h1>
          <p>Make Noteworthy work for you. Manage your call and privacy preferences.</p>
        </div>
        <div className="settings-grid">
          <section className="settings-card call-preferences">
            <h2>Call preferences</h2>
            <p>Choose the devices you’ll use for your next AI call.</p>
            {(
              [
                [
                  "microphone",
                  "Microphone",
                  "Used for your voice",
                  ["Default microphone", "External microphone"],
                ],
                [
                  "speaker",
                  "Speaker",
                  "Where you hear Noteworthy",
                  ["System default", "Headphones"],
                ],
                ["camera", "Camera", "Your camera is optional", ["Default camera", "Camera off"]],
              ] as const
            ).map(([key, title, hint, options]) => (
              <div className="setting-row device-row" key={key}>
                <div>
                  <strong>{title}</strong>
                  <small>{hint}</small>
                </div>
                <span className="device-select">
                  <select value={prefs[key]} onChange={(e) => update(key, e.target.value)}>
                    {options.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </span>
              </div>
            ))}
            <div className="setting-row toggle-row">
              <div>
                <strong>Live captions</strong>
                <small>Show captions during your AI calls.</small>
              </div>
              <Toggle
                checked={prefs.captions}
                onChange={() => update("captions", !prefs.captions)}
                label="Live captions"
              />
            </div>
          </section>
          <div className="settings-side">
            <section className="settings-card account-card">
              <h2>Account</h2>
              <p>Manage your profile and sign-in details.</p>
              <button
                onClick={() => setStatus("Account management is ready for your profile details.")}
              >
                Manage account <span>→</span>
              </button>
            </section>
            <section className="settings-card privacy-card">
              <h2>Privacy &amp; notifications</h2>
              <div className="setting-row toggle-row">
                <div>
                  <strong>Save call transcripts</strong>
                  <small>Keep transcripts after your calls.</small>
                </div>
                <Toggle
                  checked={prefs.transcripts}
                  onChange={() => update("transcripts", !prefs.transcripts)}
                  label="Save call transcripts"
                />
              </div>
              <div className="setting-row toggle-row">
                <div>
                  <strong>Call reminders</strong>
                  <small>Get a gentle nudge to check in.</small>
                </div>
                <Toggle
                  checked={prefs.reminders}
                  onChange={() => update("reminders", !prefs.reminders)}
                  label="Call reminders"
                />
              </div>
            </section>
          </div>
        </div>
        <div className="settings-actions">
          <p>
            {status ||
              (changed ? "You have unsaved changes." : "Preferences apply to your next call.")}
          </p>
          <div>
            <button
              onClick={() => {
                setPrefs(saved);
                setStatus("Changes cancelled.");
              }}
            >
              Cancel
            </button>
            <button
              className="primary"
              disabled={!changed}
              onClick={() => {
                setSaved(prefs);
                setStatus("Changes saved.");
              }}
            >
              Save changes
            </button>
          </div>
        </div>
      </section>
      {meetingActive && <FloatingMeeting openMeeting={() => go("call")} />}
      <BottomNav screen="settings" go={go} />
    </main>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("login");
  const [meetingActive, setMeetingActive] = useState(false);
  const [pageLoading, setPageLoading] = useState<string | null>(null);
  const [meetingControls, setMeetingControls] = useState<MeetingControls>(() => {
    try {
      const saved = window.localStorage.getItem("noteworthy-meeting-controls");
      return saved ? JSON.parse(saved) : { muted: false, camera: true, transcriptOpen: true };
    } catch {
      return { muted: false, camera: true, transcriptOpen: true };
    }
  });

  useEffect(() => {
    window.localStorage.setItem("noteworthy-meeting-controls", JSON.stringify(meetingControls));
  }, [meetingControls]);

  function updateMeetingControls(updates: Partial<MeetingControls>) {
    setMeetingControls((current) => ({ ...current, ...updates }));
  }

  async function loadInto(nextScreen: Screen, message: string, delay = 1400) {
    setPageLoading(message);
    await new Promise((resolve) => window.setTimeout(resolve, delay));
    if (nextScreen === "call") setMeetingActive(true);
    setScreen(nextScreen);
    setPageLoading(null);
  }

  function navigate(nextScreen: Screen) {
    if (nextScreen === "call") setMeetingActive(true);
    setScreen(nextScreen);
  }

  function endMeeting() {
    setMeetingActive(false);
    setScreen("home");
  }

  if (pageLoading) return <LoadingScreen message={pageLoading} />;
  if (screen === "login")
    return <Login onLogin={() => void loadInto("home", "Getting your space ready…")} />;
  if (screen === "call") {
    return (
      <Meeting
        minimize={() => setScreen("home")}
        endMeeting={endMeeting}
        controls={meetingControls}
        updateControls={updateMeetingControls}
      />
    );
  }
  if (screen === "logs")
    return (
      <ChatLogs meetingActive={meetingActive} openMeeting={() => setScreen("call")} go={navigate} />
    );
  if (screen === "settings") return <Settings go={navigate} meetingActive={meetingActive} />;
  return (
    <Home
      go={navigate}
      meetingActive={meetingActive}
      startCall={() => void loadInto("call", "Connecting you with Northy…", 1450)}
    />
  );
}
