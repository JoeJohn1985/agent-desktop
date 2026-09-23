'use strict';

/**
 * Tests für src/ssh-remote.js — Kommandobau für den Claude-Code-(SSH)-Provider.
 *
 * Schwerpunkt liegt auf dem Quoting: SSH übergibt keine Argumentliste, sondern
 * fügt seine Argumente zu einem String zusammen, den eine Shell auf der
 * Gegenseite ausführt. Ein ungequoteter Pfad ist damit kein Anzeigefehler,
 * sondern Codeausführung auf dem Zielrechner.
 */

const {
  shellQuote,
  SOURCE_NVM_PREFIX,
  buildAdapterCommand,
  buildProbeCommand,
  parseProbeOutput,
  buildListDirCommand,
  parseListDirOutput,
  STRICT_HOST_KEY_OPT,
  buildPasswordEnv,
  buildOneShotSshArgs,
} = require('../src/ssh-remote');

describe('shellQuote', () => {
  test('umschließt einen einfachen Wert mit einfachen Anführungszeichen', () => {
    expect(shellQuote('/home/pi')).toBe("'/home/pi'");
  });

  test('macht Leerzeichen unschädlich (sonst zwei Argumente statt einem)', () => {
    expect(shellQuote('/home/pi/mein projekt')).toBe("'/home/pi/mein projekt'");
  });

  test('neutralisiert einen Semikolon-Anhang (Befehlsverkettung)', () => {
    const quoted = shellQuote('/tmp; rm -rf /');
    expect(quoted).toBe("'/tmp; rm -rf /'");
    // Innerhalb einfacher Anführungszeichen ist ';' nur ein Zeichen.
    expect(quoted.startsWith("'")).toBe(true);
    expect(quoted.endsWith("'")).toBe(true);
  });

  test('neutralisiert Befehlssubstitution ($(...) und Backticks)', () => {
    expect(shellQuote('/tmp/$(whoami)')).toBe("'/tmp/$(whoami)'");
    expect(shellQuote('/tmp/`whoami`')).toBe("'/tmp/`whoami`'");
  });

  test('bricht bei einem enthaltenen einfachen Anführungszeichen nicht aus', () => {
    // Das ist der einzige Fall, der ausbrechen KÖNNTE: schließen, escapen,
    // wieder öffnen. Ergebnis darf keine unbalancierte Quote hinterlassen.
    expect(shellQuote("/tmp/o'brien")).toBe("'/tmp/o'\\''brien'");
  });

  test('macht einen Ausbruchsversuch mit Quote plus Befehl unschädlich', () => {
    const evil = "/tmp'; rm -rf ~; echo '";
    const quoted = shellQuote(evil);
    // Kein einziges unescaptes ' im Inneren -> die Shell sieht einen String.
    expect(quoted).toBe("'/tmp'\\''; rm -rf ~; echo '\\'''");
  });

  test('verarbeitet Nicht-Strings ohne zu werfen', () => {
    expect(shellQuote(undefined)).toBe("'undefined'");
    expect(shellQuote(42)).toBe("'42'");
  });
});

describe('buildAdapterCommand', () => {
  test('wechselt ins Verzeichnis und ersetzt die Shell durch den Adapter', () => {
    expect(buildAdapterCommand('/home/pi/projekt', 'pkg@1.2.3'))
      .toBe(`${SOURCE_NVM_PREFIX}cd '/home/pi/projekt' && exec npx -y 'pkg@1.2.3'`);
  });

  test('quotet sowohl Verzeichnis als auch Paketangabe', () => {
    const cmd = buildAdapterCommand('/tmp; evil', 'pkg@1.0; evil');
    expect(cmd).toBe(`${SOURCE_NVM_PREFIX}cd '/tmp; evil' && exec npx -y 'pkg@1.0; evil'`);
  });

  test('nutzt exec, damit kein Shell-Prozess zwischen SSH und Adapter bleibt', () => {
    expect(buildAdapterCommand('/x', 'p@1')).toContain('&& exec npx');
  });

  test('lädt nvm vorab, falls vorhanden — deckt Node-Installationen ab, deren PATH-Eintrag nur in ~/.bashrc steht (von SSH nicht-interaktiv nicht geladen)', () => {
    const cmd = buildAdapterCommand('/x', 'p@1');
    expect(cmd).toContain('.nvm/nvm.sh');
    expect(cmd.indexOf('.nvm/nvm.sh')).toBeLessThan(cmd.indexOf('cd '));
  });

  test('nvm-Vorlauf ist still (Ausgabe umgeleitet) — darf den JSON-RPC-Stream des Adapters nicht verunreinigen', () => {
    expect(buildAdapterCommand('/x', 'p@1')).toContain('>/dev/null 2>&1');
  });
});

describe('buildProbeCommand', () => {
  test('fragt Node- und Claude-Version ab', () => {
    const cmd = buildProbeCommand();
    expect(cmd).toContain('echo NODE=$(node --version');
    expect(cmd).toContain('echo CLAUDE=$(claude --version');
  });

  test('ohne cwd wird die Verzeichnisprüfung übersprungen', () => {
    expect(buildProbeCommand()).toContain('echo CWD=skip');
    expect(buildProbeCommand('')).toContain('echo CWD=skip');
  });

  test('mit cwd wird auf Existenz geprüft, quotet', () => {
    expect(buildProbeCommand('/home/pi')).toContain("[ -d '/home/pi' ]");
  });

  test('quotet einen bösartigen cwd', () => {
    expect(buildProbeCommand('/tmp; rm -rf /')).toContain("[ -d '/tmp; rm -rf /' ]");
  });

  test('lädt nvm vorab, falls vorhanden (gleiche Begründung wie bei buildAdapterCommand)', () => {
    expect(buildProbeCommand()).toContain('.nvm/nvm.sh');
  });

  test('fängt fehlende Programme ab, statt das Skript abzubrechen', () => {
    expect(buildProbeCommand()).toContain('|| true');
  });
});

describe('parseProbeOutput', () => {
  test('liest beide Versionen aus', () => {
    const out = 'NODE=v20.11.0\nCLAUDE=2.1.248\nCWD=yes\n';
    expect(parseProbeOutput(out)).toEqual({
      nodeVersion: 'v20.11.0',
      claudeVersion: '2.1.248',
      cwdOk: true,
    });
  });

  test('fehlendes Programm ergibt null, nicht einen leeren String', () => {
    const out = 'NODE=v20.11.0\nCLAUDE=\nCWD=no\n';
    const r = parseProbeOutput(out);
    expect(r.claudeVersion).toBeNull();
    expect(r.cwdOk).toBe(false);
  });

  test('CWD=skip bedeutet "nicht geprüft", nicht "existiert nicht"', () => {
    expect(parseProbeOutput('NODE=v1\nCLAUDE=1\nCWD=skip\n').cwdOk).toBeUndefined();
  });

  test('verkraftet Windows-Zeilenenden und leere Ausgabe', () => {
    expect(parseProbeOutput('NODE=v20\r\nCLAUDE=1.0\r\nCWD=yes\r\n').nodeVersion).toBe('v20');
    expect(parseProbeOutput('')).toEqual({ nodeVersion: null, claudeVersion: null, cwdOk: undefined });
  });
});

describe('buildListDirCommand', () => {
  test('ohne Pfad wird das Home-Verzeichnis genutzt (~ unquotet, sonst keine Expansion)', () => {
    expect(buildListDirCommand()).toBe('cd ~ && pwd && ls -1 -p');
    expect(buildListDirCommand('')).toBe('cd ~ && pwd && ls -1 -p');
  });

  test('ein übergebener Pfad wird gequotet', () => {
    expect(buildListDirCommand('/home/pi')).toBe("cd '/home/pi' && pwd && ls -1 -p");
  });

  test('quotet einen bösartigen Pfad', () => {
    expect(buildListDirCommand('/tmp; rm -rf /')).toBe("cd '/tmp; rm -rf /' && pwd && ls -1 -p");
  });

  test('fragt pwd ab, damit .. und ~ aufgelöst zurückkommen', () => {
    expect(buildListDirCommand('/a/..')).toContain('&& pwd &&');
  });
});

describe('parseListDirOutput', () => {
  test('trennt aufgelösten Pfad von den Einträgen', () => {
    const out = '/home/pi\nprojekt/\nnotizen.txt\nbilder/\n';
    expect(parseListDirOutput(out)).toEqual({ path: '/home/pi', dirs: ['bilder', 'projekt'] });
  });

  test('filtert Dateien heraus — nur Verzeichnisse (Schrägstrich) zählen', () => {
    const out = '/x\ndatei.md\nskript.sh\n';
    expect(parseListDirOutput(out).dirs).toEqual([]);
  });

  test('entfernt den markierenden Schrägstrich aus den Namen', () => {
    expect(parseListDirOutput('/x\nabc/\n').dirs).toEqual(['abc']);
  });

  test('sortiert alphabetisch', () => {
    expect(parseListDirOutput('/x\nzeta/\nalpha/\nBeta/\n').dirs).toEqual(['alpha', 'Beta', 'zeta']);
  });

  test('verkraftet Windows-Zeilenenden und leere Ausgabe', () => {
    expect(parseListDirOutput('/home/pi\r\nprojekt/\r\n')).toEqual({ path: '/home/pi', dirs: ['projekt'] });
    expect(parseListDirOutput('')).toEqual({ path: '', dirs: [] });
  });

  test('Verzeichnis ohne Unterordner ergibt eine leere Liste, keinen Fehler', () => {
    expect(parseListDirOutput('/home/pi/leer\n')).toEqual({ path: '/home/pi/leer', dirs: [] });
  });
});

describe('buildPasswordEnv', () => {
  test('ohne Passwort: leeres Objekt (Key-Weg bleibt unberührt)', () => {
    expect(buildPasswordEnv(null, 'C:\\askpass.cmd')).toEqual({});
    expect(buildPasswordEnv(undefined, 'C:\\askpass.cmd')).toEqual({});
    expect(buildPasswordEnv('', 'C:\\askpass.cmd')).toEqual({});
  });

  test('mit Passwort: SSH_ASKPASS-Env-Set inkl. erzwungenem Askpass', () => {
    expect(buildPasswordEnv('geheim123', 'C:\\askpass.cmd')).toEqual({
      SSH_ASKPASS: 'C:\\askpass.cmd',
      SSH_ASKPASS_REQUIRE: 'force',
      AGENT_DESKTOP_SSH_PW: 'geheim123',
    });
  });

  test('landet nie in einem Kommandozeilen-Argument o.ä. — nur als Env-Wert', () => {
    const env = buildPasswordEnv('p@ss; rm -rf /', 'C:\\askpass.cmd');
    expect(env.AGENT_DESKTOP_SSH_PW).toBe('p@ss; rm -rf /');
    expect(Object.values(env).join(' ')).not.toContain('askpass.cmd p@ss');
  });
});

describe('buildOneShotSshArgs', () => {
  test('ohne Passwort: BatchMode=yes, kein Askpass-Env (heutiges Verhalten unverändert)', () => {
    const { args, env } = buildOneShotSshArgs(null, 'C:\\askpass.cmd');
    expect(args).toContain('BatchMode=yes');
    expect(env).toEqual({});
  });

  test('mit Passwort: kein BatchMode (würde Askpass unterdrücken), Askpass-Env gesetzt', () => {
    const { args, env } = buildOneShotSshArgs('geheim123', 'C:\\askpass.cmd');
    expect(args.join(' ')).not.toContain('BatchMode');
    expect(env.SSH_ASKPASS).toBe('C:\\askpass.cmd');
    expect(env.AGENT_DESKTOP_SSH_PW).toBe('geheim123');
  });

  test('enthält in beiden Fällen StrictHostKeyChecking=accept-new', () => {
    expect(buildOneShotSshArgs(null, 'x').args).toEqual(expect.arrayContaining(STRICT_HOST_KEY_OPT));
    expect(buildOneShotSshArgs('pw', 'x').args).toEqual(expect.arrayContaining(STRICT_HOST_KEY_OPT));
  });

  test('enthält -T (kein TTY) und einen ConnectTimeout', () => {
    const { args } = buildOneShotSshArgs(null, 'x');
    expect(args).toContain('-T');
    expect(args).toContain('ConnectTimeout=10');
  });
});
