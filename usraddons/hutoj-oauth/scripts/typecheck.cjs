// Hydro's workspace exports source instead of declarations. Check diagnostics for
// this plugin without imposing its strict options on all unrelated Hydro code.
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].filter(
    (d) => !d.file || path.resolve(d.file.fileName).startsWith(`${root}${path.sep}`),
);
if (diagnostics.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n',
    }));
    process.exitCode = 1;
} else console.log('Plugin typecheck passed (Hydro dependency diagnostics excluded).');
