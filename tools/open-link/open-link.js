// Attention Planner: opens the local path in an ap-open: link. Windows Script Host runs it (JScript, so plain ES3).
// It opens only folders, and files of the kinds below, inside the folders listed in roots.txt next to it.

var KINDS = { md: 1, markdown: 1, txt: 1, pdf: 1, png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1 };

function lower(s) {
  return String(s).toLowerCase();
}

// The path to open, or why not. roots: allowed folders; kindOf(path) says 'folder', 'file' or '' (not there).
function decide(url, roots, kindOf) {
  var m = /^ap-open:(?:\/\/)?(.*)$/i.exec(url);
  if (!m) return { error: 'Not an ap-open: link' };
  var path;
  try {
    path = decodeURIComponent(m[1]);
  } catch (e) {
    return { error: 'The link is garbled' };
  }
  path = path.replace(/\//g, '\\');
  if (path.length > 3) path = path.replace(/\\+$/, '');
  if (!/^[A-Za-z]:\\/.test(path)) return { error: 'Only paths on a drive, like D:\\notes' };
  if (/[\x00-\x1f<>"|?*]/.test(path) || path.indexOf(':', 2) >= 0) return { error: 'Not a valid path' };
  var parts = path.split('\\');
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === '..' || parts[i] === '.') return { error: 'Paths with . or .. are not opened' };
  }
  var inside = false;
  for (var j = 0; j < roots.length; j++) {
    var root = lower(roots[j]).replace(/\//g, '\\');
    if (root.charAt(root.length - 1) !== '\\') root += '\\';
    if ((lower(path) + '\\').indexOf(root) === 0) inside = true;
  }
  if (!inside) return { error: 'Outside the allowed folders (' + roots.join(', ') + ')' };
  var kind = kindOf(path);
  if (!kind) return { error: 'Not found' };
  if (kind === 'file') {
    var dot = parts[parts.length - 1].lastIndexOf('.');
    var ext = dot > 0 ? lower(parts[parts.length - 1].slice(dot + 1)) : '';
    if (!KINDS.hasOwnProperty(ext)) return { error: 'Only folders and .md, .txt, .pdf or image files are opened' };
  }
  return { open: path, kind: kind };
}

function main() {
  var fso = new ActiveXObject('Scripting.FileSystemObject');
  var shell = new ActiveXObject('Shell.Application');
  var list = fso.GetParentFolderName(WScript.ScriptFullName) + '\\roots.txt';
  var roots = [];
  if (fso.FileExists(list)) {
    var f = fso.OpenTextFile(list, 1, false, -1); // UTF-16, as install.ps1 writes it
    while (!f.AtEndOfStream) {
      var line = f.ReadLine().replace(/^\s+|\s+$/g, '');
      if (line) roots.push(line);
    }
    f.Close();
  }
  if (WScript.Arguments.length < 1) {
    WScript.Echo('Opens an ap-open: link. Allowed folders: ' + (roots.join(', ') || 'none'));
    return;
  }
  var url = WScript.Arguments(0);
  var r = decide(url, roots, function (p) {
    return fso.FolderExists(p) ? 'folder' : fso.FileExists(p) ? 'file' : '';
  });
  if (r.error) {
    new ActiveXObject('WScript.Shell').Popup('Not opened: ' + url + '\n\n' + r.error, 0, 'Attention Planner', 48);
  } else if (r.kind === 'folder') {
    shell.ShellExecute('explorer.exe', '"' + r.open + '"', '', 'open', 1);
  } else {
    shell.ShellExecute(r.open, '', '', 'open', 1);
  }
}

if (typeof WScript !== 'undefined') main();
