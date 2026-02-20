import { scanContentSafety } from './security/content.js';

function nextApprovalId(stateService) {
  let candidate = '';
  do {
    candidate = `appr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  } while (stateService.getApproval(candidate));
  return candidate;
}

function parseScheduleTime(iso) {
  if (typeof iso !== 'string') return null;
  const parsedMs = Date.parse(iso);
  if (!Number.isFinite(parsedMs)) return null;
  return new Date(parsedMs).toISOString();
}

function parseCommand(text) {
  if (!text || !text.startsWith('/')) return null;
  const [name, ...rest] = text.trim().split(/\s+/);
  return { name: name.toLowerCase(), args: rest };
}

function idempotencyKey(envelope, commandName) {
  if (!envelope.message_id) return null;
  return `${envelope.channel || 'unknown'}:${envelope.message_id}:${commandName}`;
}

function parseKeyValueArgs(args) {
  const out = {};
  for (const token of args) {
    const [k, ...rest] = String(token).split('=');
    if (!k || rest.length === 0) continue;
    out[k.toLowerCase()] = rest.join('=');
  }
  return out;
}

function toInt(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function summarizeForConfirm(name, result) {
  if (name === '/post') {
    const ok = (result.data || []).filter((x) => x.ok).length;
    const total = (result.data || []).length;
    return `Posted ${ok}/${total} targets.`;
  }
  if (name === '/schedule') {
    return `Scheduled ${result.data.platform} at ${result.data.scheduledAt} with id ${result.data.id}.`;
  }
  if (name === '/approve') {
    return 'Approval executed.';
  }
  return 'Command executed.';
}

export function buildDrafts(topic) {
  const base = topic?.trim() || 'Untitled idea';

  const twitter = `Hook: ${base}.\n\nShort take with a clear action. #AI #Productivity`;
  const telegram = `**${base}**\n\nContext, examples, and practical next steps for your audience.`;
  const linkedin = `${base}\n\nMost teams miss this because they optimize for noise over clarity.\n\nHere is a practical framework you can apply this week.\n\n#Leadership #AI #Productivity`;

  return {
    twitter: { text: twitter, chars: twitter.length },
    telegram: { text: telegram, chars: telegram.length },
    linkedin: { text: linkedin, chars: linkedin.length }
  };
}

async function executeAction(action, ctx) {
  const { name, args } = action;
  const { auth, queue, logger, platformClients, config, stateService } = ctx;

  if (name === '/signoff') {
    auth.signoff(ctx.envelope.user_id);
    return { ok: true, message: 'Session ended.' };
  }

  if (name === '/session') {
    return {
      ok: true,
      data: {
        authenticated: auth.isAuthenticated(ctx.envelope.user_id),
        timeoutMinutes: config.bot.sessionTimeoutMinutes,
        userId: ctx.envelope.user_id,
        ownerId: config.owner.id
      }
    };
  }

  if (name === '/status') {
    const queueItems = queue.list();
    const deadLetters = queueItems.filter((x) => x.status === 'dead_letter').length;
    const pendingApprovals = stateService.listApprovals().filter((a) => a.status === 'pending').length;
    return {
      ok: true,
      message: `Queue ${queueItems.length} items, ${deadLetters} dead-letter, ${pendingApprovals} approvals pending.`,
      data: {
        queueSize: queueItems.length,
        scheduled: queueItems.filter((x) => x.status === 'scheduled').length,
        retrying: queueItems.filter((x) => x.status === 'retrying').length,
        failed: queueItems.filter((x) => x.status === 'failed').length,
        deadLetter: deadLetters,
        pendingApprovals,
        versions: config.versions
      }
    };
  }

  if (name === '/logs') {
    const kv = parseKeyValueArgs(args);
    const limit = toInt(kv.limit ?? args[0], 50, 1, 500);
    const offset = toInt(kv.offset ?? args[1], 0, 0, 50000);
    const query = logger.query({
      event: kv.event,
      since: kv.since,
      until: kv.until,
      limit,
      offset
    });
    return {
      ok: true,
      message: query.total === 0
        ? 'Logs 0-0 of 0.'
        : `Logs ${query.offset + 1}-${Math.min(query.offset + query.items.length, query.total)} of ${query.total}.`,
      data: query
    };
  }

  if (name === '/audit') {
    const kv = parseKeyValueArgs(args);
    const limit = toInt(kv.limit, 100, 1, 500);
    const event = kv.event;
    const since = kv.since;
    const until = kv.until;
    const logQuery = logger.query({ event, since, until, limit });
    return {
      ok: true,
      data: {
        metrics: stateService.getMetrics(),
        versions: config.versions,
        pendingApprovals: stateService.listApprovals().filter((a) => a.status === 'pending'),
        filters: { event: event || null, since: since || null, until: until || null, limit },
        recentEvents: logQuery.items,
        totalMatchingEvents: logQuery.total
      }
    };
  }

  if (name === '/queue') {
    const page = toInt(args[0], 1, 1, 100000);
    const pageSize = toInt(args[1], 20, 1, 200);
    const items = queue.list();
    const offset = (page - 1) * pageSize;
    const paged = items.slice(offset, offset + pageSize);
    return {
      ok: true,
      message: `Queue page ${page}, showing ${paged.length} of ${items.length}.`,
      data: {
        page,
        pageSize,
        total: items.length,
        items: paged
      }
    };
  }

  if (name === '/draft') {
    const [, ...topicParts] = args;
    const topic = topicParts.join(' ');
    return { ok: true, data: buildDrafts(topic) };
  }

  if (name === '/post') {
    const [platform = 'all', ...contentParts] = args;
    const content = contentParts.join(' ').trim();
    if (!content) return { ok: false, message: 'Missing content.' };

    const targets = platform === 'all' ? Object.keys(platformClients) : [platform];
    const results = [];

    for (const target of targets) {
      const client = platformClients[target];
      if (!client) return { ok: false, message: `Unsupported platform: ${target}` };

      try {
        const posted = await client.post(content);
        logger.log('post.published', {
          traceId: ctx.traceId,
          platform: target,
          remoteId: posted.id
        });
        results.push({ ok: true, ...posted });
      } catch (error) {
        logger.log('post.publish_failed', {
          traceId: ctx.traceId,
          platform: target,
          error: error.message
        });
        results.push({ ok: false, platform: target, error: error.message });
      }
    }

    return { ok: results.some((x) => x.ok), data: results };
  }

  if (name === '/schedule') {
    const [platform, time, ...contentParts] = args;
    if (!platform || !time || contentParts.length === 0) {
      return { ok: false, message: 'Usage: /schedule [platform] [ISO time] [content]' };
    }
    const normalizedTime = parseScheduleTime(time);
    if (!normalizedTime) {
      return { ok: false, message: 'Invalid schedule time. Use an ISO-8601 timestamp.' };
    }

    if (!platformClients[platform]) {
      return { ok: false, message: `Unsupported platform: ${platform}` };
    }

    const conflict = queue.findScheduleConflict({
      platform,
      scheduledAt: normalizedTime,
      minGapHours: config.schedule.minPostGapHours
    });
    if (conflict) {
      return {
        ok: false,
        message: `Schedule conflict with ${conflict.id} at ${conflict.scheduledAt}`
      };
    }

    const content = contentParts.join(' ').trim();
    const item = queue.schedule({
      platform,
      scheduledAt: normalizedTime,
      content,
      idempotencyKey: idempotencyKey(ctx.envelope, '/schedule')
    });
    logger.log('post.scheduled', {
      traceId: ctx.traceId,
      id: item.id,
      platform,
      scheduledAt: normalizedTime
    });
    return { ok: true, data: item };
  }

  if (name === '/approve') {
    const [approvalId] = args;
    if (!approvalId) return { ok: false, message: 'Usage: /approve [approval_id]' };

    const pending = stateService.getApproval(approvalId);
    if (!pending || pending.status !== 'pending') {
      return { ok: false, message: 'Pending approval not found.' };
    }

    stateService.updateApproval(approvalId, {
      status: 'approved',
      approvedAt: new Date().toISOString()
    });

    const rerun = await executeAction({ name: pending.command, args: pending.args }, ctx);
    return { ok: rerun.ok, data: rerun.data, message: rerun.message || 'Approved and executed.' };
  }

  if (name === '/reject') {
    const [approvalId] = args;
    if (!approvalId) return { ok: false, message: 'Usage: /reject [approval_id]' };

    const pending = stateService.getApproval(approvalId);
    if (!pending || pending.status !== 'pending') {
      return { ok: false, message: 'Pending approval not found.' };
    }

    stateService.updateApproval(approvalId, {
      status: 'rejected',
      rejectedAt: new Date().toISOString()
    });
    return { ok: true, message: `Rejected ${approvalId}.` };
  }

  if (name === '/delete') {
    const id = args[0];
    if (!id) return { ok: false, message: 'Missing id.' };
    const removed = queue.remove(id);
    return { ok: removed, message: removed ? 'Removed.' : 'Not found.' };
  }

  if (name === '/analytics') {
    const [platform = 'all', period = '7d'] = args;
    if (platform === 'all') {
      const result = {};
      for (const [key, client] of Object.entries(platformClients)) {
        try {
          result[key] = await client.analytics(period);
        } catch (error) {
          result[key] = { error: error.message };
        }
      }
      return { ok: true, data: result };
    }

    const client = platformClients[platform];
    if (!client) return { ok: false, message: `Unsupported platform: ${platform}` };
    try {
      return { ok: true, data: await client.analytics(period) };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }

  logger.log('command.unhandled', { traceId: ctx.traceId, command: name });
  return { ok: false, message: `Command not implemented: ${name}` };
}

export async function handleCommand(ctx) {
  const started = Date.now();
  const { envelope, auth, logger, policyEngine, stateService } = ctx;

  const parsed = parseCommand(envelope.text);
  if (!parsed) {
    return { ok: false, message: 'Unknown input. Use a slash command.' };
  }

  stateService.incrementMetric('commandCount');

  const key = idempotencyKey(envelope, parsed.name);
  if (key) {
    const cached = stateService.getIdempotency(key);
    if (cached) {
      return { ...cached, idempotentReplay: true };
    }
  }

  const authz = policyEngine.canExecute(parsed.name);
  if (!authz.allowed) {
    return { ok: false, message: `Blocked by policy: ${parsed.name}` };
  }

  if (!auth.isOwner(envelope.user_id)) {
    return { ok: false, message: '⛔ Unauthorized. This bot operates under single-owner authority.' };
  }

  if (['/post', '/schedule'].includes(parsed.name)) {
    const content = parsed.name === '/schedule'
      ? parsed.args.slice(2).join(' ')
      : parsed.args.slice(1).join(' ');
    const safety = scanContentSafety(content);
    if (!safety.safe) {
      logger.log('content.flagged', { traceId: ctx.traceId, command: parsed.name, flags: safety.flags });
      return { ok: false, message: `Content flagged: ${safety.flags.join(', ')}` };
    }
  }

  const approvalContext = {
    platform: parsed.name === '/post' ? (parsed.args[0] || 'all') : undefined
  };

  if (policyEngine.needsApproval(parsed.name, approvalContext) && parsed.name !== '/approve' && parsed.name !== '/reject') {
    const approval = stateService.addApproval({
      id: nextApprovalId(stateService),
      status: 'pending',
      createdAt: new Date().toISOString(),
      command: parsed.name,
      args: parsed.args,
      traceId: ctx.traceId,
      requestedBy: envelope.user_id
    });

    const response = {
      ok: true,
      requiresApproval: true,
      approvalId: approval.id,
      message: `Approval required. Run /approve ${approval.id} to execute.`
    };

    if (key) stateService.setIdempotency(key, response);
    return response;
  }

  const result = await executeAction(parsed, ctx);
  const latency = Date.now() - started;
  logger.log('command.executed', {
    traceId: ctx.traceId,
    command: parsed.name,
    ok: result.ok,
    latencyMs: latency
  });

  const response = {
    ...result,
    confirmation: result.ok ? summarizeForConfirm(parsed.name, result) : undefined
  };

  if (key) stateService.setIdempotency(key, response);
  return response;
}
