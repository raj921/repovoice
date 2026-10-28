import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, BookOpen, Braces, Check,
  CheckCheck, ChevronDown, ChevronRight, CircleHelp, Command, ExternalLink,
  FileCode2, FolderOpen, GitBranch as Github, Keyboard, LoaderCircle, Menu,
  Moon, Plus, Search, ShieldCheck, SlidersHorizontal, Sparkles, Sun, Terminal,
  TriangleAlert, X,
} from 'lucide-react';
import { scanRepo, type Scan, type Term } from './extract';
import { MAX_ENTRIES, toDictionaryCsv, toSnippets, type Correction } from './exporters';
import { fromFolder, fromGitHub } from './sources';
import { accuracy, learnedCorrections, pickTestTerms, scoreRow, type RowResult } from './voicetest';
import { StatCards, type StatCardData } from './components/spectrumui/charts/stat-cards';
import { CodeBlock } from './components/spectrumui/blocks/ai-assistants/code-block';
import { demoRepo } from './demo';

type Page = 'scan' | 'dictionary' | 'export' | 'test';
type Filter = 'all' | 'correction' | 'vocab' | 'package' | 'risky';
type Round = 'before' | 'after';
interface Saved { learned: Correction[]; rounds: Partial<Record<Round, RowResult[]>>; testTerms: string[] }
const emptySaved = (): Saved => ({ learned: [], rounds: {}, testTerms: [] });
const DEFAULT_SELECTED = 200;
const navigation = [
  { id: 'scan', label: 'Repository', icon: FolderOpen, step: '01' },
  { id: 'dictionary', label: 'Dictionary', icon: BookOpen, step: '02' },
  { id: 'export', label: 'Snippets & export', icon: Braces, step: '03' },
  { id: 'test', label: 'Voice test', icon: AudioLines, step: '04' },
] as const;

function readSaved(name: string): Saved {
  try {
    const value = JSON.parse(localStorage.getItem(`repovoice:${name}`) ?? 'null');
    if (value && Array.isArray(value.learned) && Array.isArray(value.testTerms) && value.rounds) return value;
  } catch { /* Storage is optional. */ }
  return emptySaved();
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function WaveMark({ small = false }: { small?: boolean }) {
  return <span className={`wave-mark ${small ? 'small' : ''}`} aria-hidden="true"><i /><i /><i /><i /><i /></span>;
}

function Modal({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    const controls = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href], [tabindex="0"]')];
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? controls()[0] ?? dialog).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key === 'Tab') {
        const elements = controls();
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`modal ${className}`}>
      <div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div>
      {children}
    </div>
  </div>;
}

function StepNav({ back, next }: { back: [string, () => void]; next: [string, () => void, boolean?] }) {
  return <nav className="step-nav" aria-label="Step navigation"><button className="button secondary" onClick={back[1]}><ArrowLeft size={15} /> {back[0]}</button><button className="button primary" disabled={next[2]} onClick={next[1]}>{next[0]} <ArrowRight size={15} /></button></nav>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

export default function App() {
  const [page, setPage] = useState<Page>('scan');
  const [scan, setScan] = useState<Scan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Saved>(emptySaved);
  const [round, setRound] = useState<Round>('before');
  const [filter, setFilter] = useState<Filter>('all');
  const [termQuery, setTermQuery] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [source, setSource] = useState<'github' | 'local'>('github');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [isDemo, setIsDemo] = useState(false);
  const [toast, setToast] = useState('');
  const [help, setHelp] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [dark, setDark] = useState(() => { let saved: string | null = null; try { saved = localStorage.getItem('repovoice:theme'); } catch { /* Optional. */ } return saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches; });
  const folderInput = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => { setIsMobile(media.matches); if (!media.matches) setMobileNav(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('repovoice:theme', dark ? 'dark' : 'light'); } catch { /* Optional. */ }
  }, [dark]);
  useEffect(() => {
    if (!scan) return;
    try { localStorage.setItem(`repovoice:${scan.repo.name}`, JSON.stringify(saved)); } catch { /* Optional. */ }
  }, [scan, saved]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommandOpen(value => !value); }
      if (e.key === 'Escape') setMobileNav(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const chosen = useMemo(() => scan?.terms.filter(t => selected.has(t.written)) ?? [], [scan, selected]);
  const testTerms = useMemo(() => {
    if (!scan) return [];
    const byWritten = new Map(scan.terms.map(t => [t.written, t]));
    return saved.testTerms.map(name => byWritten.get(name)).filter((t): t is Term => !!t);
  }, [scan, saved.testTerms]);
  const csv = scan ? toDictionaryCsv(chosen, saved.learned) : '';
  const csvRows = csv.trim() ? csv.trim().split('\n').length : 0;
  const snippets = useMemo(() => scan ? toSnippets(scan, chosen) : [], [scan, chosen]);

  function navigate(next: Page) {
    setPage(next); setMobileNav(false); setCommandOpen(false); setCommandQuery('');
    window.scrollTo({ top: 0, behavior: 'instant' });
    requestAnimationFrame(() => contentRef.current?.focus({ preventScroll: true }));
  }

  async function run(loader: () => Promise<Scan['repo']>, demo = false) {
    if (busy) return;
    setBusy(true); setError(''); setProgress('Preparing repository…');
    try {
      const repo = await loader();
      if (!repo.files.length) throw new Error('No supported source files found. Choose a folder containing code or a package manifest.');
      const next = scanRepo(repo);
      const stored = readSaved(repo.name);
      const available = new Set(next.terms.map(t => t.written));
      const oldTerms = stored.testTerms.filter(t => available.has(t));
      stored.testTerms = oldTerms.length ? oldTerms : pickTestTerms(next.terms.filter(t => !t.risky)).map(t => t.written);
      setScan(next); setSaved(stored); setIsDemo(demo);
      setSelected(new Set(next.terms.filter(t => !t.risky).slice(0, DEFAULT_SELECTED).map(t => t.written)));
      setFilter('all'); setTermQuery(''); setRound(stored.rounds.before ? 'after' : 'before');
      navigate('dictionary'); setToast(`${repo.name} is ready. ${next.terms.length} terms found.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to read this repository. Please try again.'); }
    finally { setBusy(false); setProgress(''); }
  }

  function toggleTerm(written: string) {
    setSelected(previous => { const next = new Set(previous); next.has(written) ? next.delete(written) : next.add(written); return next; });
  }
  const fileBase = scan?.repo.name.replace(/[^A-Za-z0-9._-]+/g, '-') ?? 'repository';
  function exportFile(kind: 'csv' | 'json') {
    download(`${fileBase}-${kind === 'csv' ? 'dictionary.csv' : 'snippets.json'}`, kind === 'csv' ? csv : JSON.stringify(snippets, null, 2), kind === 'csv' ? 'text/csv' : 'application/json');
    setToast(`${kind === 'csv' ? 'Dictionary' : 'Snippets'} downloaded. Import it in Wispr Flow.`);
  }

  const activeNav = navigation.find(n => n.id === page)!;
  const stats: StatCardData[] = scan ? [
    { label: 'Source files', value: scan.repo.files.length, format: v => Math.round(v).toLocaleString(), caption: `${scan.languages.length} language${scan.languages.length === 1 ? '' : 's'} detected` },
    { label: 'Terms discovered', value: scan.terms.length, format: v => Math.round(v).toLocaleString(), caption: 'Ranked for your codebase' },
    { label: 'Selected for Flow', value: chosen.length, format: v => Math.round(v).toLocaleString(), progress: Math.min(1, chosen.length / Math.max(1, scan.terms.length)), caption: `${chosen.filter(t => t.mode === 'correction').length} corrections · ${chosen.filter(t => t.mode === 'vocab').length} vocabulary` },
  ] : [];

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    {mobileNav && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`} aria-label="Workspace navigation" inert={isMobile && !mobileNav}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('scan'); }}><WaveMark /><span>RepoVoice<span className="brand-dot">.</span></span></a>
      
      <button className="sidebar-search" onClick={() => setCommandOpen(true)}><Search size={15} /><span>Quick navigation</span><kbd>⌘ K</kbd></button>
      <div className="nav-label">Steps</div>
      <nav>{navigation.map(n => <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} aria-current={page === n.id ? 'page' : undefined} disabled={!scan && n.id !== 'scan'} title={!scan && n.id !== 'scan' ? 'Scan a repository first' : undefined} onClick={() => navigate(n.id)}><n.icon size={17} /><span>{n.label}</span>{n.id === 'dictionary' && scan ? <span className="nav-count">{chosen.length}</span> : <small>{n.step}</small>}</button>)}</nav>
      <div className="sidebar-project"><div className="nav-label">Current repository</div>{scan ? <><div className="project-name"><span className="live-dot" /><span>{scan.repo.name}</span></div><small>{isDemo ? 'Demo repository' : `${scan.repo.files.length} files · ${scan.languages.join(', ') || 'Source code'}`}</small><button className="new-repo" onClick={() => navigate('scan')}><Plus size={14} /> Scan another repository</button></> : <><div className="no-project"><span className="empty-dot" /> No repository yet</div><p>Your next voice workflow<br />starts with a scan.</p></>}</div>
      <div className="sidebar-bottom"><div className="privacy-note"><ShieldCheck size={17} /><div><strong>Local by design</strong><p>Your code stays in your browser.<br />No account. No uploads.</p></div></div><div className="sidebar-controls"><button onClick={() => setHelp(true)}><CircleHelp size={16} /> Quick guide</button></div><div className="sidebar-credit">Made for <span>Wispr Flow <AudioLines size={12} /></span></div></div>
    </aside>

    <div className="workspace-main">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}><Menu size={19} /></button><span className="breadcrumb-root">Workspace</span><ChevronRight size={13} /><span>{activeNav.label}</span></div><div className="topbar-actions"><span className="local-status"><span className="live-dot" /> Runs in your browser</span><span className="topbar-divider" /><a href="https://www.wemakedevs.org/wispr" target="_blank" rel="noreferrer" className="challenge-link">No Hands Challenge <ExternalLink size={13} /></a><button className="icon-button theme-toggle" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Light theme' : 'Dark theme'} onClick={() => setDark(!dark)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button></div></header>
      <main id="main-content" ref={contentRef} tabIndex={-1} className={`main-content page-${page}`}>

        {page === 'scan' ? <>
          <div className="hero"><div className="hero-copy"><div className="eyebrow"><span className="blue-line" /> A better way to code by voice</div><h1>Your codebase.<br /><span>Fluent in Flow.</span></h1><p>Stop correcting your dictation. Turn your repository into a custom Wispr Flow dictionary, so your words land exactly right.</p><div className="hero-details"><span><Check size={13} /> Exact identifiers</span><span><Check size={13} /> Ready-to-import files</span><span><Check size={13} /> Measurable results</span></div></div><div className="translation-demo" aria-label="Example: price level update becomes PriceLevelUpdate"><div className="translation-label"><AudioLines size={14} /> You say</div><div className="spoken-example">“price level update”</div><div className="translation-connector"><span /><div><Sparkles size={13} /> your repo, understood</div><span /></div><div className="translation-label"><Terminal size={14} /> Flow types</div><div className="written-example"><span>PriceLevelUpdate</span><span className="typing-cursor" /></div><div className="translation-foot"><span className="live-dot" /> The right name. The first time.</div></div></div>

          <div className="scan-layout"><section className="panel scan-panel" aria-labelledby="scan-heading"><div className="panel-title"><div className="panel-icon"><FolderOpen size={19} /></div><div><h2 id="scan-heading">Start with a repository</h2><p>A little context makes all the difference.</p></div><span className="step-badge">Step 1</span></div><div className="source-tabs" role="tablist" aria-label="Repository source"><button role="tab" aria-selected={source === 'github'} onClick={() => setSource('github')}><Github size={16} /> GitHub repository</button><button role="tab" aria-selected={source === 'local'} onClick={() => setSource('local')}><FolderOpen size={16} /> Local folder</button></div>
            {source === 'github' ? <form onSubmit={e => { e.preventDefault(); if (repoUrl.trim()) run(() => fromGitHub(repoUrl, setProgress)); }}><label className="field-label" htmlFor="repo-url">Repository URL</label><div className="repo-input-wrap"><Github size={17} /><input id="repo-url" type="text" required value={repoUrl} onChange={e => setRepoUrl(e.target.value)} placeholder="github.com/your-name/your-repo" autoComplete="off" spellCheck={false} disabled={busy} /></div><p className="field-hint">Paste a public GitHub URL or <code>owner/repo</code>.</p><button className="button primary scan-button" disabled={busy || !repoUrl.trim()} type="submit">{busy ? <><LoaderCircle className="spin" size={16} /> Scanning repository</> : <>Scan repository <ArrowRight size={16} /></>}</button></form> : <div className="folder-drop"><div className="folder-illustration"><FolderOpen size={30} strokeWidth={1.3} /><span><ShieldCheck size={12} /></span></div><h3>Keep your repository close.</h3><p>Choose a folder on your computer.<br />Private repos welcome. Files never leave this tab.</p><button className="button primary" onClick={() => folderInput.current?.click()} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <FolderOpen size={16} />} Choose local folder</button></div>}
            <input ref={folderInput} type="file" {...{ webkitdirectory: '' }} multiple hidden aria-label="Choose repository folder" onChange={e => { const files = e.target.files; if (files?.length) run(() => fromFolder(files, setProgress)); e.target.value = ''; }} disabled={busy} />
            {busy && <div className="scan-progress" role="status"><LoaderCircle size={14} className="spin" /><span>{progress}</span><div className="indeterminate" /></div>}
            {error && <div className="error-banner" role="alert"><TriangleAlert size={16} /><span>{error}</span></div>}
            <div className="demo-action"><span>Just looking around?</span><button disabled={busy} onClick={() => run(async () => demoRepo, true)}>Explore a demo repo <ArrowRight size={13} /></button></div><div className="scan-panel-footer"><ShieldCheck size={13} /> No sign-up. No API keys. Just your code.</div></section>

          <aside className="how-it-works"><div className="eyebrow">From repository to fluency</div><h2>Four steps.<br />Fewer corrections.</h2><ol>{[{ title: 'Scan your codebase', text: 'We find the names that matter: identifiers, packages, and files.' }, { title: 'Make it your dictionary', text: 'Review the terms. Keep what you use, leave what you don’t.' }, { title: 'Bring it into Flow', text: 'Download your dictionary and snippets. Import. You’re ready.' }, { title: 'Hear the difference', text: 'A before-and-after voice test makes the improvement visible.' }].map((step, i) => <li key={step.title}><span className={`how-step ${i === 0 ? 'first' : ''}`}>{i + 1}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}</ol><button className="text-button" onClick={() => setHelp(true)}>A quick guide to importing <ArrowRight size={14} /></button></aside></div>
          <div className="bottom-strip"><span><ShieldCheck size={15} /> Private by default.</span><p>Local folders stay local. Public repositories are read directly from GitHub.</p><span className="supported-languages">Rust · TypeScript · Python · Go <span>+ more</span></span></div>
        </> : !scan ? <><PageHeading eyebrow={`Step ${Number(activeNav.step)} of 4`} title={activeNav.label} description="Your repository is the starting point." /><div className="panel empty-state"><div className="empty-icon"><activeNav.icon size={30} strokeWidth={1.3} /></div><h2>A little context first.</h2><p>Scan a repository to build a dictionary, create your<br className="desktop-only" /> snippets, and test how accurately Flow hears you.</p><button className="button primary" onClick={() => navigate('scan')}>Scan a repository <ArrowRight size={16} /></button><button className="text-button" onClick={() => run(async () => demoRepo, true)} disabled={busy}>Or explore the demo <ArrowRight size={13} /></button></div></> : <>
          <div className="repo-context"><Github size={15} /><span>{scan.repo.name}</span>{isDemo && <span className="badge neutral">Demo</span>}<span className="repo-languages">{scan.languages.join(' / ')}</span></div>

          {page === 'dictionary' && <>
            <PageHeading eyebrow="Step 2 of 4" title="Your code, in your own words." description="Choose the names Flow should know. We’ve ranked the most useful ones first." action={<button className="button primary" disabled={!chosen.length} onClick={() => navigate('export')}>Export dictionary <ArrowRight size={15} /></button>} />
            <StatCards className="repo-stats" cards={stats} columns={3} />
            <section className="panel dictionary-panel"><div className="dictionary-toolbar"><div className="filter-tabs" aria-label="Filter terms">{([['all', 'All terms'], ['correction', 'Corrections'], ['vocab', 'Vocabulary'], ['package', 'Packages'], ['risky', 'Common phrases']] as [Filter, string][]).map(([id, label]) => <button key={id} aria-pressed={filter === id} className={filter === id ? 'selected' : ''} onClick={() => setFilter(id)}>{label}{id === 'all' && <span>{scan.terms.length}</span>}</button>)}</div><div className="terms-search"><Search size={15} /><input value={termQuery} onChange={e => setTermQuery(e.target.value)} placeholder="Find a term…" aria-label="Search dictionary terms" /></div></div>
              <div className="selection-bar"><span><SlidersHorizontal size={13} /><strong>{chosen.length}</strong> selected</span><div><button onClick={() => setSelected(new Set(scan.terms.filter(t => !t.risky).slice(0, DEFAULT_SELECTED).map(t => t.written)))}>Select top {Math.min(DEFAULT_SELECTED, scan.terms.filter(t => !t.risky).length)}</button><span>·</span><button onClick={() => setSelected(new Set())}>Clear selection</button></div></div>
              <DictionaryTable scan={scan} selected={selected} filter={filter} query={termQuery} toggle={toggleTerm} />
              <div className="table-footer"><span><span className="legend-dot blue" /> Correction joins words into an identifier</span><span><span className="legend-dot gray" /> Vocabulary teaches the spelling</span></div>
            </section><StepNav back={['Repository', () => navigate('scan')]} next={['Export files', () => navigate('export'), !chosen.length]} /><div className="inline-note"><TriangleAlert size={15} /><p><strong>A note on common phrases.</strong> Terms made from everyday words start unselected, so your dictionary won’t rewrite normal sentences.</p></div>
          </>}

          {page === 'export' && <>
            <PageHeading eyebrow="Step 3 of 4" title="Ready for your next Flow." description="Your dictionary and shortcuts, in the formats Wispr Flow already understands." action={<button className="button secondary" onClick={() => navigate('dictionary')}><ArrowLeft size={15} /> Review terms</button>} />
            <div className="export-grid"><section className="panel export-panel"><div className="export-panel-heading"><div className="panel-icon blue"><BookOpen size={20} /></div><span className="file-extension">.CSV</span></div><h2>Your custom dictionary</h2><p>Exact names for the things you say every day.</p><div className="export-count"><strong>{csvRows}</strong><span> / {MAX_ENTRIES} entries</span>{saved.learned.length > 0 && <span className="badge green">{saved.learned.length} learned</span>}</div><CodeBlock className="export-code" code={csv || '# Select terms in your dictionary to create an export.'} filename={`${fileBase}-dictionary.csv`} language="csv" collapsedLines={7} variant="Numbered" /><button className="button primary full-width" onClick={() => exportFile('csv')} disabled={!csvRows}><ArrowDownToLine size={16} /> Download dictionary</button><small>Corrections + vocabulary · Headerless CSV</small></section>
              <section className="panel export-panel"><div className="export-panel-heading"><div className="panel-icon violet"><Braces size={20} /></div><span className="file-extension">.JSON</span></div><h2>Say less. Give more context.</h2><p>One spoken shortcut. A whole block of context.</p><div className="export-count"><strong>{snippets.length}</strong><span> ready-to-use snippets</span></div><CodeBlock className="export-code" code={JSON.stringify(snippets, null, 2)} filename={`${fileBase}-snippets.json`} language="json" collapsedLines={7} variant="Numbered" /><button className="button secondary full-width" onClick={() => exportFile('json')}><ArrowDownToLine size={16} /> Download snippets</button><small>Project context, file map, commands + PR template</small></section></div>
            <section className="panel import-guide"><div><div className="eyebrow">The last step</div><h2>Make yourself understood.</h2><p>Import both files in the Wispr Flow desktop app.</p></div><ol><li><span>1</span><div>Open <strong>Dictionary</strong><small>Import your downloaded .csv file.</small></div></li><li><span>2</span><div>Open <strong>Snippets</strong><small>Import your downloaded .json file.</small></div></li><li><span>3</span><div>See the difference<small>Come back for a before-and-after test.</small></div></li></ol><button className="button primary" onClick={() => navigate('test')}>Try the voice test <ArrowRight size={16} /></button></section>
            <StepNav back={['Dictionary', () => navigate('dictionary')]} next={['Run the voice test', () => navigate('test')]} />
            <details className="snippet-details"><summary>What can I say to use my snippets? <ChevronDown size={15} /></summary><div>{snippets.map(s => <div key={s.name}><span className="badge neutral">Say “{s.name}”</span><p>{s.text.slice(0, 150)}{s.text.length > 150 ? '…' : ''}</p></div>)}</div></details>
          </>}

          {page === 'test' && <VoiceTest key={scan.repo.name} scan={scan} testTerms={testTerms} saved={saved} setSaved={setSaved} round={round} setRound={setRound} onLearn={count => { setToast(`${count} correction${count === 1 ? '' : 's'} added. Download your updated dictionary.`); navigate('export'); }} onExport={() => navigate('export')} />}
        </>}

        <footer className="workspace-footer"><span><WaveMark small /> A little more fluent.</span><span>Built by voice. Made for <a href="https://wisprflow.ai" target="_blank" rel="noreferrer">Wispr Flow <ExternalLink size={10} /></a></span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><span><Check size={15} /></span>{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={14} /></button></div>}
    {help && <Modal title="A quick guide to RepoVoice" onClose={() => setHelp(false)}><div className="help-content"><p>Teach Wispr Flow the names in your codebase, then measure the difference.</p><ol><li><strong>Scan a repository.</strong> Use a public GitHub URL or a local folder. Local files never leave your browser.</li><li><strong>Review your dictionary.</strong> Corrections turn spoken phrases into exact identifiers; vocabulary teaches spelling. Common phrases start unselected.</li><li><strong>Measure your baseline.</strong> Before importing, open Voice test and dictate each phrase with Flow.</li><li><strong>Import your files.</strong> In Flow’s Dictionary, click Import and choose the .csv. In Snippets, import the .json.</li><li><strong>Try again.</strong> Run the after-import round and compare exact matches. Add real misses back to your dictionary.</li></ol><div className="help-tip"><Keyboard size={19} /><p>Use your existing Wispr Flow dictation shortcut. RepoVoice doesn’t record your microphone.</p></div><button className="button primary full-width" onClick={() => setHelp(false)}>Got it <Check size={15} /></button></div></Modal>}
    {commandOpen && <Modal title="Go to…" onClose={() => { setCommandOpen(false); setCommandQuery(''); }} className="command-modal"><div className="command-input"><Search size={18} /><input data-autofocus value={commandQuery} onChange={e => setCommandQuery(e.target.value)} placeholder="Search your workspace…" aria-label="Search workspace pages" /></div><div className="command-results">{navigation.filter(n => n.label.toLowerCase().includes(commandQuery.toLowerCase())).map(n => <button key={n.id} onClick={() => navigate(n.id)}><n.icon size={18} /><span>{n.label}</span><ArrowRight size={15} /></button>)}{!navigation.some(n => n.label.toLowerCase().includes(commandQuery.toLowerCase())) && <p>No matching pages. Try “dictionary” or “voice”.</p>}</div><div className="command-footer"><Command size={12} /> K to open <span><kbd>esc</kbd> to close</span></div></Modal>}
  </div>;
}

function DictionaryTable({ scan, selected, filter, query, toggle }: { scan: Scan; selected: Set<string>; filter: Filter; query: string; toggle: (written: string) => void }) {
  const [limit, setLimit] = useState(100);
  useEffect(() => setLimit(100), [filter, query, scan]);
  const terms = scan.terms.filter(t => {
    const type = filter === 'all' || (filter === 'correction' && t.mode === 'correction') || (filter === 'vocab' && t.mode === 'vocab') || (filter === 'package' && t.kind === 'package') || (filter === 'risky' && t.risky);
    return type && `${t.written} ${t.spoken} ${t.sources.join(' ')}`.toLowerCase().includes(query.toLowerCase());
  });
  return <><div className="table-scroll"><table className="dictionary-table"><thead><tr><th><span className="sr-only">Include</span></th><th>When you say</th><th>Flow should type</th><th>Type</th><th className="source-col">Found in</th><th className="uses-col">Uses</th></tr></thead><tbody>{terms.slice(0, limit).map(t => <tr key={t.written} className={selected.has(t.written) ? '' : 'unselected'}><td><input type="checkbox" checked={selected.has(t.written)} onChange={() => toggle(t.written)} aria-label={`Include ${t.written}`} /></td><td><span className="spoken-term">“{t.spoken}”</span></td><td><span className="term-identifier"><ArrowRight size={12} /><code>{t.written}</code></span></td><td><span className={`badge ${t.risky ? 'amber' : t.mode === 'correction' ? 'blue' : 'neutral'}`}>{t.risky ? 'Common phrase' : t.mode === 'correction' ? 'Correction' : 'Vocabulary'}</span></td><td className="source-col"><span title={t.sources.join('\n')}><FileCode2 size={12} />{t.sources[0]?.split('/').pop() ?? t.kind}</span></td><td className="uses-col">{t.count}</td></tr>)}</tbody></table>{!terms.length && <div className="table-empty"><Search size={24} /><h3>No terms found</h3><p>{scan.terms.length ? 'Try a different search or filter.' : 'This repository has no useful terms to add. Try another repository.'}</p></div>}</div>{terms.length > limit && <button className="load-more" onClick={() => setLimit(limit + 100)}>Show more terms <Plus size={14} /><span>{Math.min(limit, terms.length)} of {terms.length}</span></button>}</>;
}

function VoiceTest({ scan, testTerms, saved, setSaved, round, setRound, onLearn, onExport }: {
  scan: Scan; testTerms: Term[]; saved: Saved; setSaved: (saved: Saved) => void;
  round: Round; setRound: (round: Round) => void; onLearn: (count: number) => void; onExport: () => void;
}) {
  const [drafts, setDrafts] = useState<Partial<Record<Round, string[]>>>({});
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const current = saved.rounds[round];
  const values = drafts[round] ?? testTerms.map((_, i) => current?.[i]?.heard ?? '');
  const answered = values.filter(v => v.trim()).length;
  const before = saved.rounds.before, after = saved.rounds.after;
  const b = before?.some(r => r.heard) ? accuracy(before) : null;
  const a = after?.some(r => r.heard) ? accuracy(after) : null;
  const unchanged = !!current && testTerms.every((t, i) => scoreRow(t.written, values[i] ?? '').heard === current[i]?.heard);
  const misses = current && unchanged ? learnedCorrections(current).filter(c => !saved.learned.some(l => l.heard.toLowerCase() === c.heard.toLowerCase())) : [];
  const scoreStats: StatCardData[] = [
    { label: 'Before import', value: b ?? 0, format: v => b === null ? '—' : `${Math.round(v)}%`, progress: (b ?? 0) / 100, caption: b === null ? 'Set your baseline' : `${before!.filter(r => r.exact).length} exact matches` },
    { label: 'After import', value: a ?? 0, format: v => a === null ? '—' : `${Math.round(v)}%`, progress: (a ?? 0) / 100, caption: a === null ? 'Import, then test again' : `${after!.filter(r => r.exact).length} exact matches` },
  ];
  function score(next = values) {
    setSaved({ ...saved, rounds: { ...saved.rounds, [round]: testTerms.map((t, i) => scoreRow(t.written, next[i] ?? '')) } });
  }
  return <>
    <PageHeading eyebrow="Step 4 of 4" title="Less correcting. More creating." description="Say the same names before and after importing. See what Flow gets exactly right." action={<button className="button secondary" onClick={onExport}><ArrowDownToLine size={15} /> Import files first</button>} />
    <StatCards className="voice-stats" cards={scoreStats} columns={2} />
    {a !== null && b !== null && <div className={`improvement-banner ${a < b ? 'negative' : ''}`}><CheckCheck size={21} /><p>From <strong>{b}%</strong> to <strong>{a}%</strong> exact matches on {scan.repo.name}.<span>{a - b >= 0 ? '+' : ''}{a - b} percentage points</span></p></div>}
    {!testTerms.length ? <div className="panel empty-state"><AudioLines size={28} /><h2>No test terms available</h2><p>Scan a repository with identifiers to start a voice test.</p></div> : <section className="panel voice-panel"><div className="voice-panel-top"><div className="round-tabs"><button aria-pressed={round === 'before'} className={round === 'before' ? 'selected' : ''} onClick={() => setRound('before')}>01 <span>Before import</span></button><button aria-pressed={round === 'after'} className={round === 'after' ? 'selected' : ''} onClick={() => setRound('after')}>02 <span>After import</span></button></div><span>{answered} / {testTerms.length} answered</span></div><div className="dictation-instruction"><span className="instruction-icon"><AudioLines size={20} /></span><div><strong>Let your voice do the typing.</strong><p>Click a field, hold your Flow key <kbd>fn</kbd>, and say the phrase. Release to insert it.</p></div></div><div className="voice-table-heading"><span>The name to say</span><span>What Flow heard</span></div><div className="voice-rows">{testTerms.map((t, i) => {
      const r = current?.[i]; const valid = !!r?.heard && r.heard === scoreRow(t.written, values[i] ?? '').heard;
      return <div key={t.written} className={`voice-row ${valid ? r.exact ? 'exact' : 'missed' : ''}`}><span className="row-number">{String(i + 1).padStart(2, '0')}</span><div className="voice-target"><code>{t.written}</code><small>Say “{t.spoken}”</small></div><div className="voice-input"><input ref={el => { inputs.current[i] = el; }} type="text" value={values[i] ?? ''} placeholder="Your words go here…" spellCheck={false} autoComplete="off" aria-label={`What Flow typed for ${t.written}`} onChange={e => { const next = [...values]; next[i] = e.target.value; setDrafts({ ...drafts, [round]: next }); const native = e.nativeEvent as InputEvent; if (next[i].trim() && (native.inputType === 'insertFromPaste' || (native.data?.length ?? 0) > 1)) { if (inputs.current[i + 1]) inputs.current[i + 1]?.focus(); else score(next); } }} onKeyDown={e => { if (e.key === 'Enter') { if (inputs.current[i + 1]) inputs.current[i + 1]?.focus(); else score(); } }} />{valid && <span aria-label={r.exact ? 'Exact match' : 'Mismatch'}>{r.exact ? <Check size={15} /> : <X size={15} />}</span>}</div></div>;
    })}</div><div className="voice-actions"><button className="text-button muted" onClick={() => { setDrafts({ ...drafts, [round]: testTerms.map(() => '') }); const next = { ...saved.rounds }; delete next[round]; setSaved({ ...saved, rounds: next }); }}>Clear this round</button><span className="spacer" />{misses.length > 0 && <button className="button secondary" onClick={() => { const unique = [...new Map(misses.map(c => [c.heard.toLowerCase(), c])).values()]; setSaved({ ...saved, learned: [...saved.learned, ...unique] }); onLearn(unique.length); }}><Plus size={14} /> Learn {misses.length} missed term{misses.length === 1 ? '' : 's'}</button>}<button className="button primary" disabled={!answered} onClick={() => score()}>Score this round <ArrowRight size={15} /></button></div></section>}
    <div className="inline-note"><ShieldCheck size={15} /><p><strong>Measured, not guessed.</strong> Only answered fields count toward your score. Matches are case-sensitive; surrounding punctuation is ignored. Results are saved on this device.</p></div>
  </>;
}
