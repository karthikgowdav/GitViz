'use strict';

const { parseGitRepository } = require('./git_reader');
const { ingestParsedRepo } = require('../db/ingest');

/**
 * Parses a Git repository and stores the resulting data
 * using the existing P2 database ingestion contract.
 *
 * @param {object} pool - PostgreSQL connection pool
 * @param {string} repoPath - Absolute path to the Git repository
 * @returns {Promise<object>} Database ingestion result
 */
async function ingestRepository(pool, repoPath) {
  if (!pool) {
    throw new Error('Database pool is required');
  }

  if (!repoPath || typeof repoPath !== 'string') {
    throw new Error('Repository path must be a non-empty string');
  }

  // P1: Extract repository history using the Git reader.
  const parsedRepo = await parseGitRepository(repoPath);

  // P2: Persist the parsed payload using the frozen ingestion contract.
  return ingestParsedRepo(pool, parsedRepo);
}

module.exports = {
  ingestRepository
};