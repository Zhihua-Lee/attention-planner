var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, 'name', { value, configurable: true });

// .wrangler/tmp/pages-8xGSJX/functionsWorker-0.5983161752650675.mjs
var __create = Object.create;
var __defProp2 = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name2 = /* @__PURE__ */ __name(
  (target, value) => __defProp2(target, 'name', { value, configurable: true }),
  '__name',
);
var __esm = /* @__PURE__ */ __name(
  (fn, res) =>
    /* @__PURE__ */ __name(function __init() {
      return (fn && (res = (0, fn[__getOwnPropNames(fn)[0]])((fn = 0))), res);
    }, '__init'),
  '__esm',
);
var __commonJS = /* @__PURE__ */ __name(
  (cb, mod) =>
    /* @__PURE__ */ __name(function __require() {
      return (mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports);
    }, '__require'),
  '__commonJS',
);
var __copyProps = /* @__PURE__ */ __name((to, from, except, desc) => {
  if ((from && typeof from === 'object') || typeof from === 'function') {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp2(to, key, {
          get: /* @__PURE__ */ __name(() => from[key], 'get'),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
}, '__copyProps');
var __toESM = /* @__PURE__ */ __name(
  (mod, isNodeMode, target) => (
    (target = mod != null ? __create(__getProtoOf(mod)) : {}),
    __copyProps(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp2(target, 'default', { value: mod, enumerable: true }) : target,
      mod,
    )
  ),
  '__toESM',
);
function calendarUrl(raw) {
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith('[')
  )
    return null;
  return url;
}
__name(calendarUrl, 'calendarUrl');
async function onRequestGet({ request }) {
  const url = calendarUrl(new URL(request.url).searchParams.get('url'));
  if (!url) return text('Not a calendar address.', 400);
  let upstream;
  try {
    upstream = await fetch(url.toString(), {
      headers: { Accept: 'text/calendar, text/plain;q=0.5' },
      redirect: 'follow',
      cf: { cacheTtl: 600, cacheEverything: true },
    });
  } catch {
    return text('The calendar could not be reached.', 502);
  }
  if (!upstream.ok) return text(`The calendar answered ${upstream.status}.`, 502);
  const length = Number(upstream.headers.get('Content-Length') ?? 0);
  if (length > MAX_BYTES) return text('The calendar is too large.', 413);
  const body = await upstream.text();
  if (body.length > MAX_BYTES) return text('The calendar is too large.', 413);
  if (!/^﻿?\s*BEGIN:VCALENDAR/i.test(body)) return text('That address did not return a calendar.', 415);
  return new Response(body, {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300' },
  });
}
__name(onRequestGet, 'onRequestGet');
var MAX_BYTES;
var text;
var init_ics = __esm({
  'ics.ts'() {
    'use strict';
    init_functionsRoutes_0_3377614676319959();
    MAX_BYTES = 3 * 1024 * 1024;
    __name2(calendarUrl, 'calendarUrl');
    text = /* @__PURE__ */ __name2(
      (body, status) =>
        new Response(body, {
          status,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        }),
      'text',
    );
    __name2(onRequestGet, 'onRequestGet');
  },
});
var routes;
var init_functionsRoutes_0_3377614676319959 = __esm({
  '../.wrangler/tmp/pages-8xGSJX/functionsRoutes-0.3377614676319959.mjs'() {
    'use strict';
    init_ics();
    routes = [
      {
        routePath: '/ics',
        mountPath: '/',
        method: 'GET',
        middlewares: [],
        modules: [onRequestGet],
      },
    ];
  },
});
var require_dist = __commonJS({
  '../../attention-planner-mcp/node_modules/path-to-regexp/dist/index.js'(exports) {
    'use strict';
    init_functionsRoutes_0_3377614676319959();
    Object.defineProperty(exports, '__esModule', { value: true });
    exports.PathError = exports.TokenData = void 0;
    exports.parse = parse;
    exports.compile = compile;
    exports.match = match2;
    exports.pathToRegexp = pathToRegexp;
    exports.stringify = stringify;
    var DEFAULT_DELIMITER = '/';
    var NOOP_VALUE = /* @__PURE__ */ __name2((value) => value, 'NOOP_VALUE');
    var ID_START = /^[$_\p{ID_Start}]$/u;
    var ID_CONTINUE = /^[$\u200c\u200d\p{ID_Continue}]$/u;
    var ID = /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u;
    var SIMPLE_TOKENS = '{}()[]+?!';
    function escapeText(str) {
      return str.replace(/[{}()\[\]+?!:*\\]/g, '\\$&');
    }
    __name(escapeText, 'escapeText');
    __name2(escapeText, 'escapeText');
    function escape(str) {
      return str.replace(/[.+*?^${}()[\]|/\\]/g, '\\$&');
    }
    __name(escape, 'escape');
    __name2(escape, 'escape');
    var TokenData = class {
      static {
        __name(this, 'TokenData');
      }
      static {
        __name2(this, 'TokenData');
      }
      constructor(tokens, originalPath) {
        this.tokens = tokens;
        this.originalPath = originalPath;
      }
    };
    exports.TokenData = TokenData;
    var PathError = class extends TypeError {
      static {
        __name(this, 'PathError');
      }
      static {
        __name2(this, 'PathError');
      }
      constructor(message, originalPath) {
        let text2 = message;
        if (originalPath) text2 += `: ${originalPath}`;
        text2 += `; visit https://git.new/pathToRegexpError for info`;
        super(text2);
        this.originalPath = originalPath;
      }
    };
    exports.PathError = PathError;
    function parse(str, options = {}) {
      const { encodePath = NOOP_VALUE } = options;
      const chars = [...str];
      const tokens = [];
      let index = 0;
      let pos = 0;
      function name() {
        let value = '';
        if (ID_START.test(chars[index])) {
          do {
            value += chars[index++];
          } while (ID_CONTINUE.test(chars[index]));
        } else if (chars[index] === '"') {
          let quoteStart = index;
          while (index < chars.length) {
            if (chars[++index] === '"') {
              index++;
              quoteStart = 0;
              break;
            }
            if (chars[index] === '\\') index++;
            value += chars[index];
          }
          if (quoteStart) {
            throw new PathError(`Unterminated quote at index ${quoteStart}`, str);
          }
        }
        if (!value) {
          throw new PathError(`Missing parameter name at index ${index}`, str);
        }
        return value;
      }
      __name(name, 'name');
      __name2(name, 'name');
      while (index < chars.length) {
        const value = chars[index++];
        if (SIMPLE_TOKENS.includes(value)) {
          tokens.push({ type: value, index, value });
        } else if (value === '\\') {
          tokens.push({ type: 'escape', index, value: chars[index++] });
        } else if (value === ':') {
          tokens.push({ type: 'param', index, value: name() });
        } else if (value === '*') {
          tokens.push({ type: 'wildcard', index, value: name() });
        } else {
          tokens.push({ type: 'char', index, value });
        }
      }
      tokens.push({ type: 'end', index, value: '' });
      function consumeUntil(endType) {
        const output = [];
        while (true) {
          const token = tokens[pos++];
          if (token.type === endType) break;
          if (token.type === 'char' || token.type === 'escape') {
            let path = token.value;
            let cur = tokens[pos];
            while (cur.type === 'char' || cur.type === 'escape') {
              path += cur.value;
              cur = tokens[++pos];
            }
            output.push({
              type: 'text',
              value: encodePath(path),
            });
            continue;
          }
          if (token.type === 'param' || token.type === 'wildcard') {
            output.push({
              type: token.type,
              name: token.value,
            });
            continue;
          }
          if (token.type === '{') {
            output.push({
              type: 'group',
              tokens: consumeUntil('}'),
            });
            continue;
          }
          throw new PathError(`Unexpected ${token.type} at index ${token.index}, expected ${endType}`, str);
        }
        return output;
      }
      __name(consumeUntil, 'consumeUntil');
      __name2(consumeUntil, 'consumeUntil');
      return new TokenData(consumeUntil('end'), str);
    }
    __name(parse, 'parse');
    __name2(parse, 'parse');
    function compile(path, options = {}) {
      const { encode = encodeURIComponent, delimiter = DEFAULT_DELIMITER } = options;
      const data = typeof path === 'object' ? path : parse(path, options);
      const fn = tokensToFunction(data.tokens, delimiter, encode);
      return /* @__PURE__ */ __name2(
        /* @__PURE__ */ __name(function path2(params = {}) {
          const [path3, ...missing] = fn(params);
          if (missing.length) {
            throw new TypeError(`Missing parameters: ${missing.join(', ')}`);
          }
          return path3;
        }, 'path2'),
        'path',
      );
    }
    __name(compile, 'compile');
    __name2(compile, 'compile');
    function tokensToFunction(tokens, delimiter, encode) {
      const encoders = tokens.map((token) => tokenToFunction(token, delimiter, encode));
      return (data) => {
        const result = [''];
        for (const encoder of encoders) {
          const [value, ...extras] = encoder(data);
          result[0] += value;
          result.push(...extras);
        }
        return result;
      };
    }
    __name(tokensToFunction, 'tokensToFunction');
    __name2(tokensToFunction, 'tokensToFunction');
    function tokenToFunction(token, delimiter, encode) {
      if (token.type === 'text') return () => [token.value];
      if (token.type === 'group') {
        const fn = tokensToFunction(token.tokens, delimiter, encode);
        return (data) => {
          const [value, ...missing] = fn(data);
          if (!missing.length) return [value];
          return [''];
        };
      }
      const encodeValue = encode || NOOP_VALUE;
      if (token.type === 'wildcard' && encode !== false) {
        return (data) => {
          const value = data[token.name];
          if (value == null) return ['', token.name];
          if (!Array.isArray(value) || value.length === 0) {
            throw new TypeError(`Expected "${token.name}" to be a non-empty array`);
          }
          return [
            value
              .map((value2, index) => {
                if (typeof value2 !== 'string') {
                  throw new TypeError(`Expected "${token.name}/${index}" to be a string`);
                }
                return encodeValue(value2);
              })
              .join(delimiter),
          ];
        };
      }
      return (data) => {
        const value = data[token.name];
        if (value == null) return ['', token.name];
        if (typeof value !== 'string') {
          throw new TypeError(`Expected "${token.name}" to be a string`);
        }
        return [encodeValue(value)];
      };
    }
    __name(tokenToFunction, 'tokenToFunction');
    __name2(tokenToFunction, 'tokenToFunction');
    function match2(path, options = {}) {
      const { decode = decodeURIComponent, delimiter = DEFAULT_DELIMITER } = options;
      const { regexp, keys } = pathToRegexp(path, options);
      const decoders = keys.map((key) => {
        if (decode === false) return NOOP_VALUE;
        if (key.type === 'param') return decode;
        return (value) => value.split(delimiter).map(decode);
      });
      return /* @__PURE__ */ __name2(
        /* @__PURE__ */ __name(function match3(input) {
          const m = regexp.exec(input);
          if (!m) return false;
          const path2 = m[0];
          const params = /* @__PURE__ */ Object.create(null);
          for (let i = 1; i < m.length; i++) {
            if (m[i] === void 0) continue;
            const key = keys[i - 1];
            const decoder = decoders[i - 1];
            params[key.name] = decoder(m[i]);
          }
          return { path: path2, params };
        }, 'match3'),
        'match',
      );
    }
    __name(match2, 'match2');
    __name2(match2, 'match');
    function pathToRegexp(path, options = {}) {
      const { delimiter = DEFAULT_DELIMITER, end = true, sensitive = false, trailing = true } = options;
      const root = new SourceNode('^');
      const paths = [path];
      let combinations = 0;
      while (paths.length) {
        const path2 = paths.shift();
        if (Array.isArray(path2)) {
          paths.push(...path2);
          continue;
        }
        const data = typeof path2 === 'object' ? path2 : parse(path2, options);
        flatten(data.tokens, 0, [], (tokens) => {
          if (combinations++ >= 256) {
            throw new PathError('Too many path combinations', data.originalPath);
          }
          let node = root;
          for (const part of toRegExpSource(tokens, delimiter, data.originalPath)) {
            node = node.add(part.source, part.key);
          }
          node.add('');
        });
      }
      const keys = [];
      let pattern = toRegExp(root, keys);
      if (trailing) pattern += '(?:' + escape(delimiter) + '$)?';
      pattern += end ? '$' : '(?=' + escape(delimiter) + '|$)';
      return { regexp: new RegExp(pattern, sensitive ? '' : 'i'), keys };
    }
    __name(pathToRegexp, 'pathToRegexp');
    __name2(pathToRegexp, 'pathToRegexp');
    function toRegExp(node, keys) {
      if (node.key) keys.push(node.key);
      const children = Object.keys(node.children);
      const text2 = children.map((id) => toRegExp(node.children[id], keys)).join('|');
      return node.source + (children.length < 2 ? text2 : `(?:${text2})`);
    }
    __name(toRegExp, 'toRegExp');
    __name2(toRegExp, 'toRegExp');
    var SourceNode = class _SourceNode {
      static {
        __name(this, '_SourceNode');
      }
      static {
        __name2(this, 'SourceNode');
      }
      constructor(source, key) {
        this.source = source;
        this.key = key;
        this.children = /* @__PURE__ */ Object.create(null);
      }
      add(source, key) {
        var _a;
        const id = source + ':' + (key ? key.name : '');
        return (_a = this.children)[id] || (_a[id] = new _SourceNode(source, key));
      }
    };
    function flatten(tokens, index, result, callback) {
      while (index < tokens.length) {
        const token = tokens[index++];
        if (token.type === 'group') {
          flatten(token.tokens, 0, result.slice(), (seq) => flatten(tokens, index, seq, callback));
          continue;
        }
        result.push(token);
      }
      callback(result);
    }
    __name(flatten, 'flatten');
    __name2(flatten, 'flatten');
    function toRegExpSource(tokens, delimiter, originalPath) {
      let result = [];
      let backtrack = '';
      let wildcardBacktrack = '';
      let prevCaptureType = 0;
      let hasSegmentCapture = 0;
      let index = 0;
      function hasInSegment(index2, type) {
        while (index2 < tokens.length) {
          const token = tokens[index2++];
          if (token.type === type) return true;
          if (token.type === 'text') {
            if (token.value.includes(delimiter)) break;
          }
        }
        return false;
      }
      __name(hasInSegment, 'hasInSegment');
      __name2(hasInSegment, 'hasInSegment');
      function peekText(index2) {
        let result2 = '';
        while (index2 < tokens.length) {
          const token = tokens[index2++];
          if (token.type !== 'text') break;
          result2 += token.value;
        }
        return result2;
      }
      __name(peekText, 'peekText');
      __name2(peekText, 'peekText');
      while (index < tokens.length) {
        const token = tokens[index++];
        if (token.type === 'text') {
          result.push({ source: escape(token.value) });
          backtrack += token.value;
          if (prevCaptureType === 2) wildcardBacktrack += token.value;
          if (token.value.includes(delimiter)) hasSegmentCapture = 0;
          continue;
        }
        if (token.type === 'param' || token.type === 'wildcard') {
          if (prevCaptureType && !backtrack) {
            throw new PathError(`Missing text before "${token.name}" ${token.type}`, originalPath);
          }
          if (token.type === 'param') {
            result.push({
              source: hasSegmentCapture
                ? `(${negate(delimiter, backtrack)}+?)`
                : hasInSegment(index, 'wildcard')
                  ? `(${negate(delimiter, peekText(index))}+?)`
                  : `(${negate(delimiter, '')}+?)`,
              key: token,
            });
            hasSegmentCapture |= prevCaptureType = 1;
          } else {
            result.push({
              source:
                hasSegmentCapture & 2
                  ? `(${negate(backtrack, '')}+?)`
                  : hasSegmentCapture & 1
                    ? `(${negate(wildcardBacktrack, '')}+?)`
                    : wildcardBacktrack
                      ? `(${negate(wildcardBacktrack, '')}+?|${negate(delimiter, '')}+?)`
                      : `([^]+?)`,
              key: token,
            });
            wildcardBacktrack = '';
            hasSegmentCapture |= prevCaptureType = 2;
          }
          backtrack = '';
          continue;
        }
        throw new TypeError(`Unknown token type: ${token.type}`);
      }
      return result;
    }
    __name(toRegExpSource, 'toRegExpSource');
    __name2(toRegExpSource, 'toRegExpSource');
    function negate(a, b) {
      if (b.length > a.length) return negate(b, a);
      if (a === b) b = '';
      if (b.length > 1) return `(?:(?!${escape(a)}|${escape(b)})[^])`;
      if (a.length > 1) return `(?:(?!${escape(a)})[^${escape(b)}])`;
      return `[^${escape(a + b)}]`;
    }
    __name(negate, 'negate');
    __name2(negate, 'negate');
    function stringifyTokens(tokens, index) {
      let value = '';
      while (index < tokens.length) {
        const token = tokens[index++];
        if (token.type === 'text') {
          value += escapeText(token.value);
          continue;
        }
        if (token.type === 'group') {
          value += '{' + stringifyTokens(token.tokens, 0) + '}';
          continue;
        }
        if (token.type === 'param') {
          value += ':' + stringifyName(token.name, tokens[index]);
          continue;
        }
        if (token.type === 'wildcard') {
          value += '*' + stringifyName(token.name, tokens[index]);
          continue;
        }
        throw new TypeError(`Unknown token type: ${token.type}`);
      }
      return value;
    }
    __name(stringifyTokens, 'stringifyTokens');
    __name2(stringifyTokens, 'stringifyTokens');
    function stringify(data) {
      return stringifyTokens(data.tokens, 0);
    }
    __name(stringify, 'stringify');
    __name2(stringify, 'stringify');
    function stringifyName(name, next) {
      if (!ID.test(name)) return JSON.stringify(name);
      if ((next === null || next === void 0 ? void 0 : next.type) === 'text' && ID_CONTINUE.test(next.value[0])) {
        return JSON.stringify(name);
      }
      return name;
    }
    __name(stringifyName, 'stringifyName');
    __name2(stringifyName, 'stringifyName');
  },
});
init_functionsRoutes_0_3377614676319959();
init_functionsRoutes_0_3377614676319959();
init_functionsRoutes_0_3377614676319959();
var import_path_to_regexp = __toESM(require_dist());
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = (0, import_path_to_regexp.match)(route.routePath.replace(escapeRegex, '\\$&'), {
      end: false,
    });
    const mountMatcher = (0, import_path_to_regexp.match)(route.mountPath.replace(escapeRegex, '\\$&'), {
      end: false,
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path,
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = (0, import_path_to_regexp.match)(route.routePath.replace(escapeRegex, '\\$&'), {
      end: true,
    });
    const mountMatcher = (0, import_path_to_regexp.match)(route.mountPath.replace(escapeRegex, '\\$&'), {
      end: false,
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path,
        };
      }
      break;
    }
  }
}
__name(executeRequest, 'executeRequest');
__name2(executeRequest, 'executeRequest');
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name2(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === 'string') {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== 'object' || value === null) {
              throw new Error('context.data must be an object');
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name2(() => {
            isFailOpen = true;
          }, 'passThroughOnException'),
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error('Your Pages function should return a Response');
        }
        return cloneResponse(response);
      } else if ('ASSETS') {
        const response = await env['ASSETS'].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, 'next');
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env['ASSETS'].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  },
};
var cloneResponse = /* @__PURE__ */ __name2(
  (response) =>
    // https://fetch.spec.whatwg.org/#null-body-status
    new Response([101, 204, 205, 304].includes(response.status) ? null : response.body, response),
  'cloneResponse',
);
init_functionsRoutes_0_3377614676319959();
var drainBody = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {}
      }
    } catch (e) {
      console.error('Failed to drain the unused request body.', e);
    }
  }
}, 'drainBody');
var middleware_ensure_req_body_drained_default = drainBody;
init_functionsRoutes_0_3377614676319959();
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause),
  };
}
__name(reduceError, 'reduceError');
__name2(reduceError, 'reduceError');
var jsonError = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      'Content-Type': 'application/json',
      'MF-Experimental-Error-Stack': 'true',
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers['MF-Experimental-Error-Stack-Payload'] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, 'jsonError');
var middleware_miniflare3_json_error_default = jsonError;
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default,
];
var middleware_insertion_facade_default = pages_template_worker_default;
init_functionsRoutes_0_3377614676319959();
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, '__facade_register__');
__name2(__facade_register__, '__facade_register__');
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    },
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, '__facade_invokeChain__');
__name2(__facade_invokeChain__, '__facade_invokeChain__');
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [...__facade_middleware__, finalMiddleware]);
}
__name(__facade_invoke__, '__facade_invoke__');
__name2(__facade_invoke__, '__facade_invoke__');
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  static {
    __name(this, '___Facade_ScheduledController__');
  }
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name2(this, '__Facade_ScheduledController__');
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError('Illegal invocation');
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name2(function (request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error('Handler does not export a fetch() function.');
    }
    return worker.fetch(request, env, ctx);
  }, 'fetchDispatcher');
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name2(function (type, init) {
        if (type === 'scheduled' && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(Date.now(), init.cron ?? '', () => {});
          return worker.scheduled(controller, env, ctx);
        }
      }, 'dispatcher');
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    },
  };
}
__name(wrapExportedHandler, 'wrapExportedHandler');
__name2(wrapExportedHandler, 'wrapExportedHandler');
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name2((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error('Entrypoint class does not define a fetch() function.');
      }
      return super.fetch(request);
    }, '#fetchDispatcher');
    #dispatcher = /* @__PURE__ */ __name2((type, init) => {
      if (type === 'scheduled' && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(Date.now(), init.cron ?? '', () => {});
        return super.scheduled(controller);
      }
    }, '#dispatcher');
    fetch(request) {
      return __facade_invoke__(request, this.env, this.ctx, this.#dispatcher, this.#fetchDispatcher);
    }
  };
}
__name(wrapWorkerEntrypoint, 'wrapWorkerEntrypoint');
__name2(wrapWorkerEntrypoint, 'wrapWorkerEntrypoint');
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === 'object') {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === 'function') {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;

// ../attention-planner-mcp/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {}
      }
    } catch (e) {
      console.error('Failed to drain the unused request body.', e);
    }
  }
}, 'drainBody');
var middleware_ensure_req_body_drained_default2 = drainBody2;

// ../attention-planner-mcp/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError2(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError2(e.cause),
  };
}
__name(reduceError2, 'reduceError');
var jsonError2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError2(e);
    const body = JSON.stringify(error);
    const headers = {
      'Content-Type': 'application/json',
      'MF-Experimental-Error-Stack': 'true',
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers['MF-Experimental-Error-Stack-Payload'] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, 'jsonError');
var middleware_miniflare3_json_error_default2 = jsonError2;

// .wrangler/tmp/bundle-Vvl0hR/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__2 = [
  middleware_ensure_req_body_drained_default2,
  middleware_miniflare3_json_error_default2,
];
var middleware_insertion_facade_default2 = middleware_loader_entry_default;

// ../attention-planner-mcp/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__2 = [];
function __facade_register__2(...args) {
  __facade_middleware__2.push(...args.flat());
}
__name(__facade_register__2, '__facade_register__');
function __facade_invokeChain__2(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__2(newRequest, newEnv, ctx, dispatch, tail);
    },
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__2, '__facade_invokeChain__');
function __facade_invoke__2(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__2(request, env, ctx, dispatch, [...__facade_middleware__2, finalMiddleware]);
}
__name(__facade_invoke__2, '__facade_invoke__');

// .wrangler/tmp/bundle-Vvl0hR/middleware-loader.entry.ts
var __Facade_ScheduledController__2 = class ___Facade_ScheduledController__2 {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, '__Facade_ScheduledController__');
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__2)) {
      throw new TypeError('Illegal invocation');
    }
    this.#noRetry();
  }
};
function wrapExportedHandler2(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function (request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error('Handler does not export a fetch() function.');
    }
    return worker.fetch(request, env, ctx);
  }, 'fetchDispatcher');
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function (type, init) {
        if (type === 'scheduled' && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__2(Date.now(), init.cron ?? '', () => {});
          return worker.scheduled(controller, env, ctx);
        }
      }, 'dispatcher');
      return __facade_invoke__2(request, env, ctx, dispatcher, fetchDispatcher);
    },
  };
}
__name(wrapExportedHandler2, 'wrapExportedHandler');
function wrapWorkerEntrypoint2(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error('Entrypoint class does not define a fetch() function.');
      }
      return super.fetch(request);
    }, '#fetchDispatcher');
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === 'scheduled' && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__2(Date.now(), init.cron ?? '', () => {});
        return super.scheduled(controller);
      }
    }, '#dispatcher');
    fetch(request) {
      return __facade_invoke__2(request, this.env, this.ctx, this.#dispatcher, this.#fetchDispatcher);
    }
  };
}
__name(wrapWorkerEntrypoint2, 'wrapWorkerEntrypoint');
var WRAPPED_ENTRY2;
if (typeof middleware_insertion_facade_default2 === 'object') {
  WRAPPED_ENTRY2 = wrapExportedHandler2(middleware_insertion_facade_default2);
} else if (typeof middleware_insertion_facade_default2 === 'function') {
  WRAPPED_ENTRY2 = wrapWorkerEntrypoint2(middleware_insertion_facade_default2);
}
var middleware_loader_entry_default2 = WRAPPED_ENTRY2;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__2 as __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default2 as default,
};
//# sourceMappingURL=functionsWorker-0.5983161752650675.js.map
