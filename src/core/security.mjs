// Security review built from REA facts (window settings, IPC, exposed APIs) plus Lumen's own
// read-only key scan. Each finding cites where it came from. Severity reflects common Electron
// hardening guidance; it is a prompt to look, not proof the app is exploitable.

import { findApplicationGraph } from './graph.mjs';

const RISKY_PREFS = {
  nodeIntegration: { bad: true, severity: 'high', title: 'Web pages can use Node.js', why: 'With nodeIntegration on, any script in the page (including injected content) can read files and run programs.' },
  contextIsolation: { bad: false, severity: 'high', title: 'Context isolation is turned off', why: 'Page scripts share a JavaScript world with the preload script, so they can tamper with privileged code.' },
  sandbox: { bad: false, severity: 'medium', title: 'Renderer sandbox is turned off', why: 'If the page is compromised, the attacker has more of the operating system available.' },
  webSecurity: { bad: false, severity: 'high', title: 'Web security is turned off', why: 'Disables the same-origin policy, letting pages read data from other sites.' },
  allowRunningInsecureContent: { bad: true, severity: 'high', title: 'Insecure (http) content allowed on secure pages', why: 'Lets unencrypted scripts run inside HTTPS pages.' },
  enableRemoteModule: { bad: true, severity: 'high', title: 'Legacy remote module enabled', why: 'Gives pages broad access to main-process objects.' },
  nodeIntegrationInWorker: { bad: true, severity: 'medium', title: 'Web workers can use Node.js', why: 'Background scripts in the page get file and process access.' },
  nodeIntegrationInSubFrames: { bad: true, severity: 'medium', title: 'Embedded frames can use Node.js', why: 'Iframes, possibly from other sites, get Node.js access.' },
  webviewTag: { bad: true, severity: 'medium', title: '<webview> tag enabled', why: 'Embedded web views are a common route to escalate from page to app.' },
  experimentalFeatures: { bad: true, severity: 'low', title: 'Experimental browser features enabled', why: 'Untested features widen the attack surface.' },
};
const DEFAULTS = {
  contextIsolation: 'Not set in code. Electron turns it on by default since version 12, so this is probably fine for recent Electron versions.',
  sandbox: 'Not set in code. Electron sandboxes pages by default since version 20 unless Node.js integration is on.',
  nodeIntegration: 'Not set in code. Electron keeps it off by default since version 5.',
};
const GENERIC_BRIDGE = /^(invoke|send|sendSync|on|once|ipc|ipcRenderer|require|exec|spawn|eval|shell|fs)$/i;

const where = evidence => (evidence?.location?.available ? evidence.location.value : null);

export function reviewSecurity({ bundle, summary, secrets }) {
  const findings = [];
  const add = f => findings.push({ source: 'rea', ...f });
  const found = bundle ? findApplicationGraph(bundle) : null;

  if (found) {
    const { graph, evidenceId } = found;
    for (const node of graph.nodes.filter(n => n.kind === 'browser-window')) {
      const o = node.observations?.[0]; const props = o?.properties ?? {}; const loc = where(o?.evidence);
      const cite = { evidenceId, nodeId: node.node_id, location: loc, field: 'web_preferences' };
      if (props.web_preferences_status && props.web_preferences_status !== 'object-literal') {
        add({ severity: 'unknown', title: 'Window security settings could not be read', detail: `The settings are built in a way REA could not read statically (${props.web_preferences_status}).`, ...cite });
        continue;
      }
      const prefs = new Map((props.web_preferences ?? []).map(p => [p.name, p.value]));
      for (const [name, rule] of Object.entries(RISKY_PREFS)) {
        const v = prefs.get(name);
        if (!v) { if (DEFAULTS[name]) add({ severity: 'info', title: `${name} not set`, detail: DEFAULTS[name], ...cite }); continue; }
        if (v.status !== 'literal') { add({ severity: 'unknown', title: `${name} is set by a computed value`, detail: 'REA could not tell what value it has at runtime. Check this setting by hand.', ...cite }); continue; }
        if (v.value === rule.bad) add({ severity: rule.severity, title: rule.title, detail: `${name}: ${JSON.stringify(v.value)}. ${rule.why}`, ...cite });
        else if (name === 'contextIsolation' || name === 'sandbox' || name === 'nodeIntegration') add({ severity: 'pass', title: `${name} is ${JSON.stringify(v.value)}`, detail: 'Safe setting, written explicitly in the code.', ...cite });
      }
    }
    for (const node of graph.nodes.filter(n => n.kind === 'context-bridge-api')) {
      const o = node.observations?.[0]; const props = o?.properties ?? {};
      const members = Array.isArray(props.members) ? props.members : [];
      const cite = { evidenceId, nodeId: node.node_id, location: where(o?.evidence), field: 'members' };
      const generic = members.filter(m => GENERIC_BRIDGE.test(m));
      if (generic.length) add({ severity: 'medium', title: `Page API “${props.api_key}” exposes general-purpose functions`, detail: `${generic.join(', ')}. Passing raw messaging or system functions to the page lets any page script call anything behind them. Expose narrow, specific functions instead.`, ...cite });
      if (props.unknown_members > 0) add({ severity: 'unknown', title: `Page API “${props.api_key}” has members REA could not list`, detail: `${props.unknown_members} member(s) are computed at runtime.`, ...cite });
      add({ severity: 'info', title: `Functions the web page can call: ${props.api_key}`, detail: members.length ? members.join(', ') : 'No members listed.', ...cite });
    }
  }

  const s = summary?.normalized_result?.summary?.electron;
  if (s) {
    const cite = { evidenceId: summary.evidence_id, field: 'normalized_result.summary.electron' };
    if (s.ipc?.main_handlers > 0 && !s.sender_validation_observations)
      add({ severity: 'medium', title: 'Message handlers do not check who sent the message', detail: `${s.ipc.main_handlers} handler(s), and REA saw no sender checks (e.g. event.senderFrame). Any page or frame that can send IPC can call them.`, ...cite });
    if (s.ipc?.dynamic_channel_operations > 0)
      add({ severity: 'low', title: 'Some message channel names are computed at runtime', detail: `${s.ipc.dynamic_channel_operations} operation(s). These are harder to audit and are not fully shown on the map.`, ...cite });
    if (s.native_addon_bindings > 0)
      add({ severity: 'info', title: 'Native add-ons are loaded', detail: `${s.native_addon_bindings} binding(s). Native code is outside what this JavaScript analysis can inspect.`, ...cite });
  }

  for (const hit of secrets?.hits ?? []) findings.push({ source: 'lumen-scan', severity: hit.severity, title: `Possible ${hit.kind} in code`, detail: `${hit.masked} (${hit.length} characters). Shown masked; Lumen never stores or shares the full value.`, location: { kind: 'file', path: hit.file, line: hit.line } });
  if (secrets?.hosts?.length) findings.push({ source: 'lumen-scan', severity: 'info', title: 'Web addresses the code mentions', detail: secrets.hosts.slice(0, 40).join(', ') + (secrets.hosts.length > 40 ? ` and ${secrets.hosts.length - 40} more` : '') });

  const order = { high: 0, medium: 1, low: 2, unknown: 3, info: 4, pass: 5 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = Object.fromEntries(Object.keys(order).map(k => [k, findings.filter(f => f.severity === k).length]));
  return { findings, counts, scan: secrets ? { filesScanned: secrets.filesScanned, bytesScanned: secrets.bytesScanned, skipped: secrets.skipped, limits: secrets.limits } : null };
}
