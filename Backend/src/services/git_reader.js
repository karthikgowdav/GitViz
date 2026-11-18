
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { StringDecoder } = require('node:string_decoder');

const execFileAsync = promisify(execFile);

const RECORD_SEPARATOR = '\x1e';
const FIELD_SEPARATOR = '\x1f';

class RepoPathError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RepoPathError';
        this.status = 400;
    }
}

function expandHome(input) {
    if (typeof input !== 'string') return '';

    const trimmed = input.trim();

    if (!trimmed) return '';
    if (trimmed === '~') return os.homedir();

    if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
        return path.join(os.homedir(), trimmed.slice(2));
    }

    return trimmed;
}

async function gitExec(repoPath, args) {
    const { stdout } = await execFileAsync(
        'git',
        [
            '-C', repoPath,
            '-c', 'core.quotepath=false',
            '--no-pager',
            ...args
        ],
        {
            encoding: 'utf8',
            timeout: 15000,
            windowsHide: true,
            env: {
                ...process.env,
                GIT_OPTIONAL_LOCKS: '0'
            }
        }
    );

    return stdout;
}

async function validateRepoPath(input) {
    const expanded = expandHome(input);

    if (!expanded) {
        throw new RepoPathError('Repository path is required');
    }

    const resolved = path.resolve(expanded);

    let stat;

    try {
        stat = fs.statSync(resolved);
    } catch {
        throw new RepoPathError(
            'Path not found or not a Git repository'
        );
    }

    if (!stat.isDirectory()) {
        throw new RepoPathError('Path is not a directory');
    }

    let realPath;

    try {
        realPath = fs.realpathSync(resolved);
    } catch {
        throw new RepoPathError('Unable to resolve repository path');
    }

    try {
        const result = await gitExec(
            realPath,
            ['rev-parse', '--is-inside-work-tree']
        );

        if (result.trim() !== 'true') {
            throw new Error('Not a Git working tree');
        }
    } catch {
        throw new RepoPathError(
            'Path not found or not a Git repository'
        );
    }

    return realPath;
}

async function readDefaultBranch(repoPath) {
    try {
        const result = await gitExec(
            repoPath,
            ['symbolic-ref', '--short', 'HEAD']
        );

        return result.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Conservative detection of commonly generated files.
 * This is separate from P2's query-time ignore list.
 */
function isGeneratedFile(filePath) {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();

    const generatedDirectories = [
        /^dist\//,
        /^build\//,
        /^coverage\//,
        /^__generated__\//,
        /\/__generated__\//
    ];

    if (generatedDirectories.some(pattern => pattern.test(normalized))) {
        return true;
    }

   const generatedPatterns = [
    /(^|\/)package-lock\.json$/,
    /(^|\/)yarn\.lock$/,
    /(^|\/)pnpm-lock\.yaml$/,
    /\.min\.(js|css)$/,
    /\.generated\.[^/]+$/,
    /\.g\.[^/]+$/
];

    return generatedPatterns.some(pattern => pattern.test(normalized));
}

function parseNumstatToken(token) {
    const firstTab = token.indexOf('\t');

    if (firstTab === -1) return null;

    const secondTab = token.indexOf('\t', firstTab + 1);

    if (secondTab === -1) return null;

    const additionsRaw = token.slice(0, firstTab);
    const deletionsRaw = token.slice(firstTab + 1, secondTab);
    const filePath = token.slice(secondTab + 1);

    // An empty path indicates a rename record in --numstat -z.
    if (!filePath) {
        return {
            isRename: true,
            additions: additionsRaw === '-' ? 0 : Number(additionsRaw) || 0,
            deletions: deletionsRaw === '-' ? 0 : Number(deletionsRaw) || 0,
            is_binary: additionsRaw === '-' || deletionsRaw === '-'
        };
    }

    const isBinary =
        additionsRaw === '-' || deletionsRaw === '-';

    return {
        isRename: false,
        file: {
            path: filePath,
            old_path: null,
            additions: isBinary ? 0 : Number(additionsRaw) || 0,
            deletions: isBinary ? 0 : Number(deletionsRaw) || 0,
            is_binary: isBinary,
            is_generated: isGeneratedFile(filePath)
        }
    };
}

/**
 * Incrementally parses NUL-delimited Git log output.
 *
 * Only the parsed commit objects are retained.
 * The complete Git stdout is never accumulated in memory.
 */
class GitLogStreamParser {
    constructor() {
        this.buffer = '';
        this.currentCommit = null;
        this.commits = [];
        this.renameState = null;
    }

    consumeToken(token) {
        // A rename has two additional NUL-delimited path tokens.
        if (this.renameState) {
            if (this.renameState.oldPath === null) {
                this.renameState.oldPath = token;
                return;
            }

            const newPath = token;
            const rename = this.renameState;

            this.currentCommit.files.push({
                path: newPath,
                old_path: rename.oldPath,
                additions: rename.additions,
                deletions: rename.deletions,
                is_binary: rename.is_binary,
                is_generated: isGeneratedFile(newPath)
            });

            this.renameState = null;
            return;
        }

        // Git separates commit metadata and numstat output with a newline.
        if (token.startsWith('\n')) {
            token = token.slice(1);
        }

        if (!token) return;

        // A new record begins with the record separator.
        if (token.startsWith(RECORD_SEPARATOR)) {
            this.finishCurrentCommit();

            const metadata = token.slice(1);
            const fields = metadata.split(FIELD_SEPARATOR);

            if (fields.length < 6) {
                throw new Error('Invalid Git commit metadata');
            }

            const [
                sha,
                parentsRaw,
                authorName,
                authorEmail,
                committedAt,
                ...messageParts
            ] = fields;

            const parents = parentsRaw.trim()
                ? parentsRaw.trim().split(/\s+/)
                : [];

            if (!sha || !committedAt || Number.isNaN(Date.parse(committedAt))) {
                throw new Error(`Invalid Git commit metadata for ${sha || 'unknown commit'}`);
            }

            this.currentCommit = {
                sha,
                parents,
                author: {
                    name: authorName || 'Unknown',
                    email: (authorEmail || '').toLowerCase()
                },
                committed_at: committedAt,
                message: messageParts.join(FIELD_SEPARATOR),
                is_merge: parents.length > 1,
                files: []
            };

            return;
        }

        if (!this.currentCommit) return;

        const parsed = parseNumstatToken(token);

        if (!parsed) return;

        if (parsed.isRename) {
            this.renameState = {
                oldPath: null,
                additions: parsed.additions,
                deletions: parsed.deletions,
                is_binary: parsed.is_binary
            };

            return;
        }

        this.currentCommit.files.push(parsed.file);
    }

    write(chunk) {
        this.buffer += chunk;

        let separatorIndex;

        while ((separatorIndex = this.buffer.indexOf('\0')) !== -1) {
            const token = this.buffer.slice(0, separatorIndex);

            this.buffer = this.buffer.slice(separatorIndex + 1);

            this.consumeToken(token);
        }
    }

    finishCurrentCommit() {
        if (this.currentCommit) {
            this.commits.push(this.currentCommit);
            this.currentCommit = null;
        }
    }

    end() {
        if (this.buffer.length > 0) {
            this.consumeToken(this.buffer);
            this.buffer = '';
        }

        if (this.renameState) {
            throw new Error('Incomplete Git rename record');
        }

        this.finishCurrentCommit();

        return this.commits;
    }
}

function streamGitHistory(repoPath, { onProgress } = {}) {
    return new Promise((resolve, reject) => {
        const parser = new GitLogStreamParser();
        const decoder = new StringDecoder('utf8');

        const format = [
            '%x1e%H',
            '%P',
            '%an',
            '%ae',
            '%cI',
            '%s%x00'
        ].join('%x1f');

        const args = [
            '-C', repoPath,
            '-c', 'core.quotepath=false',
            '--no-pager',
            'log',
            '--all',
            '--date-order',
            '-M',
            '--numstat',
            '-z',
            '--date=iso-strict',
            `--format=${format}`
        ];

        const child = spawn('git', args, {
            windowsHide: true,
            env: {
                ...process.env,
                GIT_OPTIONAL_LOCKS: '0'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderr = '';

        child.stdout.on('data', chunk => {
            try {
                parser.write(decoder.write(chunk));
            } catch (error) {
                child.kill();
                reject(error);
            }
        });

        child.stderr.on('data', chunk => {
            stderr += chunk.toString('utf8');
        });

        child.once('error', reject);

        child.once('close', (code, signal) => {
            if (code !== 0) {
                const message = stderr || `Git exited with code ${code}`;

                if (
                    /does not have any commits yet|bad default revision|unknown revision|ambiguous argument/i.test(message)
                ) {
                    resolve([]);
                    return;
                }

                reject(new Error(`${message} (signal: ${signal || 'none'})`));
                return;
            }

            try {
                parser.write(decoder.end());

                const commits = parser.end();

                if (onProgress) onProgress(90);

                resolve(commits);
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function parseGitRepository(repoPath, { onProgress } = {}) {
    const resolved = await validateRepoPath(repoPath);

    if (onProgress) onProgress(10);

    const repo = {
        path: resolved,
        name: path.basename(resolved) || 'repository',
        default_branch: await readDefaultBranch(resolved)
    };

    const commits = await streamGitHistory(resolved, { onProgress });

    if (onProgress) onProgress(100);

    return {
        repo,
        commits
    };
}

module.exports = {
    RepoPathError,
    expandHome,
    validateRepoPath,
    readDefaultBranch,
    isGeneratedFile,
    parseNumstatToken,
    GitLogStreamParser,
    streamGitHistory,
    parseGitRepository
};