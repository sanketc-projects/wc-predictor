const DATA_PATHS = {
    predictions: './data/predictions.json',
    results: './data/results.json',
    rules: './data/scoring-rules.json',
};

const BREAKDOWN_LABELS = {
    groupTopTwo: 'Groups',
    thirdAdvances: '3rd place',
    r32: 'Round of 32',
    r16: 'Round of 16',
    qf: 'Quarterfinals',
    sf: 'Semifinals',
    final: 'Final',
    third: '3rd playoff',
};

const STAGE_ORDER = ['group', 'thirdAdvances', 'r32', 'r16', 'qf', 'sf', 'third', 'final', 'champion'];
const KNOCKOUT_STAGES = ['r32', 'r16', 'qf', 'sf', 'final', 'third'];
const STAGE_LABELS = {
    group: 'Group stage',
    thirdAdvances: 'Best third-place teams',
    r32: 'Round of 32',
    r16: 'Round of 16',
    qf: 'Quarterfinals',
    sf: 'Semifinals',
    third: 'Third-place playoff',
    final: 'Final',
    champion: 'Champion',
};

const state = {
    entries: [],
    results: null,
    rules: null,
    source: null,
    matchStages: new Map(),
    teamsByCode: new Map(),
    sortBy: 'score',
    sortDirection: 'desc',
    query: '',
    selectedId: '',
    predictionFilter: 'all',
    compareA: '',
    compareB: '',
    compareFilter: 'all',
};

const leaderboardBody = document.getElementById('leaderboard-body');
const selectedPlayerContainer = document.getElementById('selected-player');
const compareASelect = document.getElementById('compare-a');
const compareBSelect = document.getElementById('compare-b');
const compareFilterSelect = document.getElementById('compare-filter');
const compareOutput = document.getElementById('compare-output');
const summaryContainer = document.getElementById('summary');
const scoringRulesContainer = document.getElementById('scoring-rules');
const searchInput = document.getElementById('search');
const sortBySelect = document.getElementById('sort-by');
const sortDirectionSelect = document.getElementById('sort-direction');
const lastUpdatedLabel = document.getElementById('last-updated');

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function normalizeCode(value) {
    return String(value ?? '').trim().toUpperCase();
}

function byMatchNumber(a, b) {
    return Number(a.code.replace(/\D/g, '')) - Number(b.code.replace(/\D/g, ''));
}

function formatTeam(teamOrCode) {
    if (!teamOrCode) return 'No pick';
    const code = typeof teamOrCode === 'string' ? normalizeCode(teamOrCode) : normalizeCode(teamOrCode.code);
    const team = typeof teamOrCode === 'string' ? state.teamsByCode.get(code) : teamOrCode;
    return team?.name ? `${team.name} (${code})` : code;
}

function shortTeam(teamOrCode) {
    const code = typeof teamOrCode === 'string' ? normalizeCode(teamOrCode) : normalizeCode(teamOrCode?.code);
    return code || 'TBD';
}

function rankLabel(rank) {
    return rank === '1' ? '1st' : rank === '2' ? '2nd' : '3rd';
}

function statusMatchesFilter(status) {
    return state.predictionFilter === 'all' || status === state.predictionFilter;
}

function compareValues(a, b) {
    const direction = state.sortDirection === 'asc' ? 1 : -1;

    if (state.sortBy === 'name') {
        return a.name.localeCompare(b.name) * direction;
    }

    const aValue = a[state.sortBy] ?? 0;
    const bValue = b[state.sortBy] ?? 0;

    if (aValue === bValue) {
        return a.rank - b.rank || a.name.localeCompare(b.name);
    }

    return (aValue > bValue ? 1 : -1) * direction;
}

function entriesMatchingQuery(entries) {
    const query = state.query.trim().toLowerCase();
    if (!query) return entries.slice();
    return entries.filter((entry) => entry.name.toLowerCase().includes(query));
}

function filteredEntries() {
    return entriesMatchingQuery(state.entries).sort(compareValues);
}

function rankedEntries() {
    return state.entries.slice().sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}

function createBreakdown() {
    return Object.fromEntries(
        Object.keys(BREAKDOWN_LABELS).map((key) => [key, { points: 0, correct: 0 }]),
    );
}

function addPoints(entry, category, points) {
    entry.score += points;
    entry.correctPicks += 1;
    entry.breakdown[category].points += points;
    entry.breakdown[category].correct += 1;
}

function actualThirdAdvancerCodes(results) {
    const groups = results.groups || {};

    return new Set(
        (results.thirdAdvancers || [])
            .map((value) => normalizeCode(value))
            .map((value) => {
                if (/^[A-L]$/.test(value) && groups[value]?.[2]) {
                    return normalizeCode(groups[value][2]);
                }

                return value;
            })
            .filter(Boolean),
    );
}

function calculatePlayerScore(player, context) {
    const entry = {
        ...player,
        score: 0,
        correctPicks: 0,
        rank: 0,
        breakdown: createBreakdown(),
    };

    const groupResults = context.results.groups || {};
    const thirdAdvancers = actualThirdAdvancerCodes(context.results);

    for (const [group, placements] of Object.entries(groupResults)) {
        const predictedGroup = player.picks.group[group] || {};

        for (const rank of ['1', '2']) {
            const actualCode = normalizeCode(placements[Number(rank) - 1]);
            const pickedCode = normalizeCode(predictedGroup[rank]?.code);

            if (actualCode && pickedCode === actualCode) {
                addPoints(entry, 'groupTopTwo', context.rules.groupTopTwo);
            }
        }
    }

    for (const group of player.picks.thirdAdvancers || []) {
        const predictedThirdCode = normalizeCode(player.picks.group[group]?.['3']?.code);

        if (predictedThirdCode && thirdAdvancers.has(predictedThirdCode)) {
            addPoints(entry, 'thirdAdvances', context.rules.thirdAdvances);
        }
    }

    for (const [matchCode, actualWinner] of Object.entries(context.results.matches || {})) {
        const stage = context.matchStages.get(matchCode);
        const points = context.rules[stage];
        const pickedWinner = player.picks.matches[matchCode] || (stage === 'final' ? player.picks.champion : null);

        if (points && normalizeCode(pickedWinner?.code) === normalizeCode(actualWinner)) {
            addPoints(entry, stage, points);
        }
    }

    return entry;
}

function assignRanks(entries) {
    const sorted = entries.slice().sort((a, b) => b.score - a.score || b.correctPicks - a.correctPicks || a.name.localeCompare(b.name));
    let previous = null;

    return sorted.map((entry, index) => {
        const rank = previous && previous.score === entry.score && previous.correctPicks === entry.correctPicks
            ? previous.rank
            : index + 1;
        const rankedEntry = { ...entry, rank };
        previous = rankedEntry;
        return rankedEntry;
    });
}

function calculateScores(predictions, results, rules) {
    const matchStages = new Map(predictions.matches.map((match) => [match.code, match.stage]));
    const entries = predictions.players.map((player) => calculatePlayerScore(player, { results, rules, matchStages }));
    return assignRanks(entries);
}

function maxAvailablePoints() {
    if (!state.results || !state.rules || !state.source) return 0;

    const groupPoints = Object.values(state.results.groups || {})
        .reduce((sum, placements) => sum + Math.min(2, placements.length) * state.rules.groupTopTwo, 0);
    const thirdPoints = (state.results.thirdAdvancers || []).length * state.rules.thirdAdvances;
    const knockoutPoints = Object.entries(state.results.matches || {}).reduce((sum, [matchCode, winner]) => {
        if (!winner) return sum;
        return sum + (state.rules[state.matchStages.get(matchCode)] || 0);
    }, 0);

    return groupPoints + thirdPoints + knockoutPoints;
}

function pickStatus(pickedCode, actualCode) {
    const picked = normalizeCode(pickedCode);
    const actual = normalizeCode(actualCode);

    if (!actual) return 'pending';
    if (!picked) return 'wrong';
    return picked === actual ? 'correct' : 'wrong';
}

function buildPredictionItems(player) {
    const items = [];
    const groupLetters = Object.keys(player.picks.group || {}).sort();

    for (const group of groupLetters) {
        const actualPlacements = state.results.groups?.[group] || [];
        const predictedGroup = player.picks.group[group] || {};

        for (const rank of ['1', '2', '3']) {
            const pickedTeam = predictedGroup[rank];
            const actualCode = actualPlacements[Number(rank) - 1];
            const scored = rank !== '3';
            items.push({
                id: `group-${group}-${rank}`,
                stage: 'group',
                label: `Group ${group} · ${rank}${rank === '1' ? 'st' : rank === '2' ? 'nd' : 'rd'}`,
                picked: formatTeam(pickedTeam),
                actual: actualCode ? formatTeam(actualCode) : 'Awaiting result',
                status: pickStatus(pickedTeam?.code, actualCode),
                points: scored && normalizeCode(pickedTeam?.code) === normalizeCode(actualCode) ? state.rules.groupTopTwo : 0,
                muted: !scored,
            });
        }
    }

    const thirdCodes = actualThirdAdvancerCodes(state.results);
    for (const group of player.picks.thirdAdvancers || []) {
        const pickedTeam = player.picks.group[group]?.['3'];
        const status = thirdCodes.size ? (thirdCodes.has(normalizeCode(pickedTeam?.code)) ? 'correct' : 'wrong') : 'pending';
        items.push({
            id: `third-${group}`,
            stage: 'thirdAdvances',
            label: `Best third · Group ${group}`,
            picked: formatTeam(pickedTeam),
            actual: thirdCodes.size ? 'Advanced list decided' : 'Awaiting best third-place teams',
            status,
            points: status === 'correct' ? state.rules.thirdAdvances : 0,
        });
    }

    const knockoutMatches = state.source.matches
        .filter((match) => match.stage !== 'group')
        .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || byMatchNumber(a, b));

    for (const match of knockoutMatches) {
        const pickedTeam = player.picks.matches[match.code];
        const actualCode = state.results.matches?.[match.code];
        const status = pickStatus(pickedTeam?.code, actualCode);
        items.push({
            id: `match-${match.code}`,
            stage: match.stage,
            label: `${STAGE_LABELS[match.stage]} · ${match.code}`,
            picked: formatTeam(pickedTeam),
            actual: actualCode ? formatTeam(actualCode) : 'Awaiting result',
            status,
            points: status === 'correct' ? state.rules[match.stage] : 0,
        });
    }

    const finalWinner = state.results.matches?.M104;
    const championStatus = pickStatus(player.picks.champion?.code, finalWinner);
    items.push({
        id: 'champion',
        stage: 'champion',
        label: 'Tournament champion',
        picked: formatTeam(player.picks.champion),
        actual: finalWinner ? formatTeam(finalWinner) : 'Awaiting final',
        status: championStatus,
        points: championStatus === 'correct' ? state.rules.final : 0,
        muted: true,
    });

    return items;
}

function renderSummary(entries) {
    if (!entries.length) {
        summaryContainer.innerHTML = '<div class="summary-card"><span>No matches</span><strong>Try another search</strong></div>';
        return;
    }

    const leaders = entries.filter((entry) => entry.rank === entries[0].rank);
    const averageScore = Math.round(entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length);
    const maxCorrect = Math.max(...entries.map((entry) => entry.correctPicks));
    const available = maxAvailablePoints();

    summaryContainer.innerHTML = `
    <div class="summary-card leader-card">
      <span>Leader${leaders.length > 1 ? 's' : ''}</span>
      <strong>${leaders.map((entry) => escapeHtml(entry.name)).join(', ')}</strong>
    </div>
    <div class="summary-card">
      <span>Average</span>
      <strong>${averageScore}</strong>
    </div>
    <div class="summary-card">
      <span>Best correct</span>
      <strong>${maxCorrect}</strong>
    </div>
    <div class="summary-card">
      <span>Available</span>
      <strong>${available}</strong>
    </div>
  `;
}

function renderBreakdown(entry) {
    return Object.entries(entry.breakdown)
        .filter(([, value]) => value.points > 0)
        .map(([key, value]) => `<span class="score-chip">${BREAKDOWN_LABELS[key]} +${value.points}</span>`)
        .join('') || '<span class="score-chip muted-chip">No points yet</span>';
}

function renderLeaderboard(entries) {
    if (!entries.length) {
        leaderboardBody.innerHTML = '<div class="empty-state">No players found.</div>';
        return;
    }

    leaderboardBody.innerHTML = entries
        .map((entry) => {
            const active = entry.id === state.selectedId ? ' is-selected' : '';
            return `
      <button class="leaderboard-row${active}" type="button" data-player-id="${escapeHtml(entry.id)}">
        <span class="rank-badge">#${entry.rank}</span>
        <span class="player-summary">
          <strong>${escapeHtml(entry.name)}</strong>
          <span>${entry.correctPicks} correct picks</span>
        </span>
        <span class="score-badge">${entry.score}<small>pts</small></span>
        <span class="row-breakdown">${renderBreakdown(entry)}</span>
      </button>
    `;
        })
        .join('');
}

function filterPredictionItems(items) {
    if (state.predictionFilter === 'all') return items;
    return items.filter((item) => item.status === state.predictionFilter);
}

function predictionStats(items) {
    return items.reduce((stats, item) => {
        stats[item.status] += 1;
        return stats;
    }, { correct: 0, wrong: 0, pending: 0 });
}

function buildGroupRows(player) {
    return Object.keys(player.picks.group || {}).sort().map((group) => {
        const actualPlacements = state.results.groups?.[group] || [];
        const predictedGroup = player.picks.group[group] || {};
        const cells = ['1', '2', '3'].map((rank) => {
            const pickedTeam = predictedGroup[rank];
            const actualCode = actualPlacements[Number(rank) - 1];
            const scored = rank !== '3';
            const status = pickStatus(pickedTeam?.code, actualCode);

            return {
                rank,
                label: rankLabel(rank),
                picked: formatTeam(pickedTeam),
                actual: actualCode ? formatTeam(actualCode) : 'Awaiting result',
                status,
                points: scored && normalizeCode(pickedTeam?.code) === normalizeCode(actualCode) ? state.rules.groupTopTwo : 0,
                muted: !scored,
            };
        });

        return { group, cells };
    });
}

function buildThirdItems(player) {
    const thirdCodes = actualThirdAdvancerCodes(state.results);

    return (player.picks.thirdAdvancers || []).map((group) => {
        const pickedTeam = player.picks.group[group]?.['3'];
        const status = thirdCodes.size ? (thirdCodes.has(normalizeCode(pickedTeam?.code)) ? 'correct' : 'wrong') : 'pending';

        return {
            id: `third-${group}`,
            stage: 'thirdAdvances',
            label: `Group ${group}`,
            picked: formatTeam(pickedTeam),
            actual: thirdCodes.size ? 'Advanced list decided' : 'Awaiting best third-place teams',
            status,
            points: status === 'correct' ? state.rules.thirdAdvances : 0,
        };
    });
}

function buildKnockoutItems(player) {
    const matches = state.source.matches
        .filter((match) => match.stage !== 'group')
        .sort((a, b) => byMatchNumber(a, b));
    const resolved = new Map();
    const usedThirdGroups = new Set();

    return matches.map((match) => {
        const pickedTeam = player.picks.matches[match.code];
        const home = resolveBracketSlot(player, match.slotHome, pickedTeam, resolved, usedThirdGroups);
        const away = resolveBracketSlot(player, match.slotAway, pickedTeam, resolved, usedThirdGroups);
        const winner = pickedTeam || null;
        const winnerCode = normalizeCode(winner?.code);
        const loser = [home, away].find((team) => normalizeCode(team?.code) && normalizeCode(team?.code) !== winnerCode) || null;
        const actualCode = state.results.matches?.[match.code];
        const status = pickStatus(winner?.code, actualCode);
        const layout = bracketLayout(match.stage, matches.filter((item) => item.stage === match.stage).findIndex((item) => item.code === match.code));

        resolved.set(match.code, { home, away, winner, loser });

        return {
            id: `match-${match.code}`,
            stage: match.stage,
            label: match.code,
            home,
            away,
            winner,
            actual: actualCode ? state.teamsByCode.get(normalizeCode(actualCode)) : null,
            status,
            points: status === 'correct' ? state.rules[match.stage] : 0,
            ...layout,
        };
    });
}

function resolveBracketSlot(player, slot, pickedTeam, resolved, usedThirdGroups) {
    const previousMatch = String(slot || '').match(/^([WL]) (M\d+)$/);
    if (previousMatch) {
        const previous = resolved.get(previousMatch[2]);
        return previousMatch[1] === 'W' ? previous?.winner || null : previous?.loser || null;
    }

    const placement = String(slot || '').match(/^([123])([A-L])$/);
    if (placement) {
        return player.picks.group[placement[2]]?.[placement[1]] || null;
    }

    const thirdSlot = String(slot || '').match(/^3-([A-L]+)$/);
    if (thirdSlot) {
        const allowedGroups = thirdSlot[1].split('');
        const candidateGroups = (player.picks.thirdAdvancers || []).filter((group) => allowedGroups.includes(group));
        const pickedCode = normalizeCode(pickedTeam?.code);
        const winnerGroup = candidateGroups.find((group) => normalizeCode(player.picks.group[group]?.['3']?.code) === pickedCode);
        const group = winnerGroup || candidateGroups.find((candidate) => !usedThirdGroups.has(candidate)) || candidateGroups[0];

        if (group) usedThirdGroups.add(group);
        return group ? player.picks.group[group]?.['3'] || null : null;
    }

    return state.teamsByCode.get(normalizeCode(slot)) || null;
}

function bracketLayout(stage, index) {
    const layouts = {
        r32: { row: index + 1, span: 1 },
        r16: { row: (index * 2) + 1, span: 2 },
        qf: { row: (index * 4) + 1, span: 4 },
        sf: { row: (index * 8) + 1, span: 8 },
        final: { row: 1, span: 16 },
        third: { row: 1, span: 16 },
    };

    return layouts[stage] || { row: index + 1, span: 1 };
}

function matchDefinition(code) {
    return state.source.matches.find((match) => match.code === code);
}

function sourceMatchCodes(code) {
    const match = matchDefinition(code);
    if (!match) return [];

    return [match.slotHome, match.slotAway]
        .map((slot) => String(slot || '').match(/^[WL] (M\d+)$/)?.[1])
        .filter(Boolean);
}

function knockoutItemsByCode(player) {
    return new Map(buildKnockoutItems(player).map((item) => [item.label, item]));
}

function playerMatchCard(item, options = {}) {
    if (!item) return '<article class="bracket-card is-empty">TBD</article>';
    const muted = options.muted ? ' is-filter-muted' : '';

    return `
        <article class="bracket-card is-${item.status}${muted}">
            <div class="bracket-card-code">${escapeHtml(item.label)}</div>
            <div class="match-teams">
                <span class="team-line${normalizeCode(item.home?.code) === normalizeCode(item.winner?.code) ? ' is-picked' : ''}">${escapeHtml(shortTeam(item.home))}</span>
                <span class="team-line${normalizeCode(item.away?.code) === normalizeCode(item.winner?.code) ? ' is-picked' : ''}">${escapeHtml(shortTeam(item.away))}</span>
            </div>
            ${item.actual ? `<span class="bracket-card-result">${escapeHtml(shortTeam(item.actual))}</span>` : ''}
        </article>
    `;
}

function renderPlayerBracketLane(title, targetStage, itemsByCode) {
    const targets = state.source.matches
        .filter((match) => match.stage === targetStage)
        .sort(byMatchNumber);
    const lanes = targets.map((target) => {
        const sourceCodes = sourceMatchCodes(target.code);
        const cards = [...sourceCodes, target.code].map((code) => itemsByCode.get(code));
        const visible = cards.some((item) => item && statusMatchesFilter(item.status));
        return { target, sourceCodes, visible };
    }).filter((lane) => lane.visible);

    if (!lanes.length) return '';

    return `
        <section class="bracket-lane-section">
            <h4>${title}</h4>
            <div class="bracket-lane-grid">
                ${lanes.map((lane) => {
        const sourceItems = lane.sourceCodes.map((code) => itemsByCode.get(code));
        const targetItem = itemsByCode.get(lane.target.code);

        return `
                    <article class="bracket-lane">
                        <div class="lane-source-stack">
                            ${sourceItems.map((item) => playerMatchCard(item, { muted: item && !statusMatchesFilter(item.status) })).join('')}
                        </div>
                        <div class="lane-connector" aria-hidden="true"></div>
                        <div class="lane-target">
                            ${playerMatchCard(targetItem, { muted: targetItem && !statusMatchesFilter(targetItem.status) })}
                        </div>
                    </article>
                `;
    }).join('')}
            </div>
        </section>
    `;
}

function renderPlayerFinalLane(itemsByCode) {
    const sourceCodes = sourceMatchCodes('M104');
    const cards = [...sourceCodes, 'M104', 'M103'].map((code) => itemsByCode.get(code));
    if (!cards.some((item) => item && statusMatchesFilter(item.status))) return '';

    return `
        <section class="bracket-lane-section">
            <h4>Medal matches</h4>
            <div class="bracket-lane-grid bracket-lane-grid-final">
                <article class="bracket-lane">
                    <div class="lane-source-stack">
                        ${sourceCodes.map((code) => {
        const item = itemsByCode.get(code);
        return playerMatchCard(item, { muted: item && !statusMatchesFilter(item.status) });
    }).join('')}
                    </div>
                    <div class="lane-connector" aria-hidden="true"></div>
                    <div class="lane-target lane-target-double">
                        ${['M104', 'M103'].map((code) => {
        const item = itemsByCode.get(code);
        return playerMatchCard(item, { muted: item && !statusMatchesFilter(item.status) });
    }).join('')}
                    </div>
                </article>
            </div>
        </section>
    `;
}

function renderGroupPredictions(player) {
    const rows = buildGroupRows(player).filter((row) => row.cells.some((cell) => statusMatchesFilter(cell.status)));

    if (!rows.length) {
        return '<section class="prediction-stage"><h3>Group stage</h3><div class="empty-state">No group picks match this filter.</div></section>';
    }

    return `
        <section class="prediction-stage">
            <h3>Group stage</h3>
            <div class="group-prediction-table">
                ${rows.map((row) => `
                    <article class="group-prediction-row">
                        <strong class="group-name">Group ${row.group}</strong>
                        ${row.cells.map((cell) => `
                            <div class="group-pick-cell is-${cell.status}${cell.muted ? ' is-muted' : ''}${statusMatchesFilter(cell.status) ? '' : ' is-filter-muted'}">
                                <span class="group-rank">${cell.label}</span>
                                <strong>${escapeHtml(cell.picked)}</strong>
                                <small>${escapeHtml(cell.actual)}</small>
                                <span class="mini-verdict">${cell.points ? `+${cell.points}` : cell.status}</span>
                            </div>
                        `).join('')}
                    </article>
                `).join('')}
            </div>
        </section>
    `;
}

function renderThirdPredictions(player) {
    const items = buildThirdItems(player).filter((item) => statusMatchesFilter(item.status));

    if (!items.length) return '';

    return `
        <section class="prediction-stage">
            <h3>Best third-place teams</h3>
            <div class="third-pick-strip">
                ${items.map((item) => `
                    <article class="third-pick-chip is-${item.status}">
                        <span>${escapeHtml(item.label)}</span>
                        <strong>${escapeHtml(item.picked)}</strong>
                        <small>${escapeHtml(item.actual)}</small>
                    </article>
                `).join('')}
            </div>
        </section>
    `;
}

function renderKnockoutBracket(player) {
    const itemsByCode = knockoutItemsByCode(player);
    const sections = [
        renderPlayerBracketLane('Round of 32 to Round of 16', 'r16', itemsByCode),
        renderPlayerBracketLane('Round of 16 to Quarterfinals', 'qf', itemsByCode),
        renderPlayerBracketLane('Quarterfinals to Semifinals', 'sf', itemsByCode),
        renderPlayerFinalLane(itemsByCode),
    ].filter(Boolean);

    if (!sections.length) {
        return '<section class="prediction-stage"><h3>Knockout bracket</h3><div class="empty-state">No knockout picks match this filter.</div></section>';
    }

    return `
        <section class="prediction-stage">
            <h3>Knockout bracket</h3>
            <div class="bracket-lane-board">${sections.join('')}</div>
        </section>
    `;
}

function renderSelectedPlayer() {
    const player = state.entries.find((entry) => entry.id === state.selectedId) || rankedEntries()[0];
    if (!player) {
        selectedPlayerContainer.innerHTML = '<div class="empty-state">Select a player to inspect picks.</div>';
        return;
    }

    state.selectedId = player.id;
    const items = buildPredictionItems(player);
    const stats = predictionStats(items);

    selectedPlayerContainer.innerHTML = `
    <div class="player-hero-card">
      <div>
        <span class="rank-badge">#${player.rank}</span>
        <h3>${escapeHtml(player.name)}</h3>
        <p>${player.score} points · ${player.correctPicks} scoring hits</p>
      </div>
      <div class="verdict-summary">
        <span class="is-correct">${stats.correct} right</span>
        <span class="is-wrong">${stats.wrong} wrong</span>
        <span class="is-pending">${stats.pending} pending</span>
      </div>
    </div>
    <div class="filter-tabs" role="group" aria-label="Filter predictions">
      ${['all', 'correct', 'wrong', 'pending'].map((filter) => `
        <button type="button" class="filter-tab${state.predictionFilter === filter ? ' is-active' : ''}" data-prediction-filter="${filter}">
          ${filter === 'all' ? 'All' : filter[0].toUpperCase() + filter.slice(1)}
        </button>
      `).join('')}
    </div>
        ${renderGroupPredictions(player)}
        ${renderThirdPredictions(player)}
        ${renderKnockoutBracket(player)}
  `;
}

function compareRows(playerA, playerB) {
    const rows = [];
    const groups = Object.keys(playerA.picks.group || {}).sort();

    for (const group of groups) {
        for (const rank of ['1', '2', '3']) {
            const actualCode = state.results.groups?.[group]?.[Number(rank) - 1];
            const aPick = playerA.picks.group[group]?.[rank];
            const bPick = playerB.picks.group[group]?.[rank];
            rows.push({
                stage: 'group',
                label: `Group ${group} · ${rank}${rank === '1' ? 'st' : rank === '2' ? 'nd' : 'rd'}`,
                a: formatTeam(aPick),
                b: formatTeam(bPick),
                actual: actualCode ? formatTeam(actualCode) : 'Pending',
                same: normalizeCode(aPick?.code) === normalizeCode(bPick?.code),
                aStatus: pickStatus(aPick?.code, actualCode),
                bStatus: pickStatus(bPick?.code, actualCode),
            });
        }
    }

    const thirdGroups = Array.from(new Set([...(playerA.picks.thirdAdvancers || []), ...(playerB.picks.thirdAdvancers || [])])).sort();
    const thirdCodes = actualThirdAdvancerCodes(state.results);
    for (const group of thirdGroups) {
        const aPick = playerA.picks.thirdAdvancers.includes(group) ? playerA.picks.group[group]?.['3'] : null;
        const bPick = playerB.picks.thirdAdvancers.includes(group) ? playerB.picks.group[group]?.['3'] : null;
        rows.push({
            stage: 'thirdAdvances',
            label: `Best third · Group ${group}`,
            a: aPick ? formatTeam(aPick) : 'Not selected',
            b: bPick ? formatTeam(bPick) : 'Not selected',
            actual: thirdCodes.size ? 'Advanced list decided' : 'Pending',
            same: normalizeCode(aPick?.code) === normalizeCode(bPick?.code),
            aStatus: thirdCodes.size ? (thirdCodes.has(normalizeCode(aPick?.code)) ? 'correct' : 'wrong') : 'pending',
            bStatus: thirdCodes.size ? (thirdCodes.has(normalizeCode(bPick?.code)) ? 'correct' : 'wrong') : 'pending',
        });
    }

    const knockoutMatches = state.source.matches
        .filter((match) => match.stage !== 'group')
        .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || byMatchNumber(a, b));

    for (const match of knockoutMatches) {
        const actualCode = state.results.matches?.[match.code];
        const aPick = playerA.picks.matches[match.code];
        const bPick = playerB.picks.matches[match.code];
        const stageMatches = knockoutMatches.filter((item) => item.stage === match.stage);
        const layout = bracketLayout(match.stage, stageMatches.findIndex((item) => item.code === match.code));
        rows.push({
            stage: match.stage,
            label: match.code,
            a: shortTeam(aPick),
            b: shortTeam(bPick),
            actual: actualCode ? shortTeam(actualCode) : 'Pending',
            same: normalizeCode(aPick?.code) === normalizeCode(bPick?.code),
            aStatus: pickStatus(aPick?.code, actualCode),
            bStatus: pickStatus(bPick?.code, actualCode),
            ...layout,
        });
    }

    const finalWinner = state.results.matches?.M104;
    rows.push({
        stage: 'champion',
        label: 'Tournament champion',
        a: formatTeam(playerA.picks.champion),
        b: formatTeam(playerB.picks.champion),
        actual: finalWinner ? formatTeam(finalWinner) : 'Pending',
        same: normalizeCode(playerA.picks.champion?.code) === normalizeCode(playerB.picks.champion?.code),
        aStatus: pickStatus(playerA.picks.champion?.code, finalWinner),
        bStatus: pickStatus(playerB.picks.champion?.code, finalWinner),
    });

    return rows;
}

function comparisonPassesFilter(same) {
    if (state.compareFilter === 'same') return same;
    if (state.compareFilter === 'different') return !same;
    return true;
}

function compareGroupRows(playerA, playerB) {
    const groups = Object.keys(playerA.picks.group || {}).sort();

    return groups.map((group) => {
        const cells = ['1', '2', '3'].map((rank) => {
            const actualCode = state.results.groups?.[group]?.[Number(rank) - 1];
            const aPick = playerA.picks.group[group]?.[rank];
            const bPick = playerB.picks.group[group]?.[rank];

            return {
                rank,
                label: rankLabel(rank),
                a: formatTeam(aPick),
                b: formatTeam(bPick),
                actual: actualCode ? formatTeam(actualCode) : 'Pending',
                same: normalizeCode(aPick?.code) === normalizeCode(bPick?.code),
                aStatus: pickStatus(aPick?.code, actualCode),
                bStatus: pickStatus(bPick?.code, actualCode),
            };
        });

        return { group, cells, same: cells.every((cell) => cell.same) };
    });
}

function renderCompareGroups(playerA, playerB) {
    const rows = compareGroupRows(playerA, playerB).filter((row) => {
        if (state.compareFilter === 'same') return row.same;
        if (state.compareFilter === 'different') return row.cells.some((cell) => !cell.same);
        return true;
    });

    if (!rows.length) return '';

    return `
        <section class="compare-section">
            <h3>Groups</h3>
            <div class="compare-group-table">
                ${rows.map((row) => `
                    <article class="compare-group-row${row.same ? ' is-same' : ' is-different'}">
                        <strong class="group-name">Group ${row.group}</strong>
                        ${row.cells.map((cell) => `
                            <div class="compare-group-cell${cell.same ? ' is-same' : ' is-different'}">
                                <span class="group-rank">${cell.label}</span>
                                <div class="compare-pair is-${cell.aStatus}"><span>A</span>${escapeHtml(cell.a)}</div>
                                <div class="compare-pair is-${cell.bStatus}"><span>B</span>${escapeHtml(cell.b)}</div>
                                <small>${escapeHtml(cell.actual)}</small>
                            </div>
                        `).join('')}
                    </article>
                `).join('')}
            </div>
        </section>
    `;
}

function renderCompareThird(rows) {
    const items = rows.filter((row) => row.stage === 'thirdAdvances' && comparisonPassesFilter(row.same));

    if (!items.length) return '';

    return `
        <section class="compare-section">
            <h3>Best third-place teams</h3>
            <div class="compare-third-strip">
                ${items.map((row) => `
                    <article class="compare-third-chip${row.same ? ' is-same' : ' is-different'}">
                        <strong>${escapeHtml(row.label)}</strong>
                        <span>A: ${escapeHtml(row.a)}</span>
                        <span>B: ${escapeHtml(row.b)}</span>
                    </article>
                `).join('')}
            </div>
        </section>
    `;
}

function compareRowsByCode(rows) {
    return new Map(rows.filter((row) => KNOCKOUT_STAGES.includes(row.stage)).map((row) => [row.label, row]));
}

function compareMatchCard(row, options = {}) {
    if (!row) return '<article class="compare-bracket-card is-empty">TBD</article>';
    const muted = options.muted ? ' is-filter-muted' : '';

    return `
        <article class="compare-bracket-card${row.same ? ' is-same' : ' is-different'}${muted}">
            <strong>${escapeHtml(row.label)}</strong>
            <div class="compare-mini-picks">
                <span><b>A</b>${escapeHtml(row.a)}</span>
                <span><b>B</b>${escapeHtml(row.b)}</span>
            </div>
            ${row.actual === 'Pending' ? '' : `<small>${escapeHtml(row.actual)}</small>`}
        </article>
    `;
}

function renderCompareLane(title, targetStage, rowsByCode) {
    const targets = state.source.matches
        .filter((match) => match.stage === targetStage)
        .sort(byMatchNumber);
    const lanes = targets.map((target) => {
        const sourceCodes = sourceMatchCodes(target.code);
        const rows = [...sourceCodes, target.code].map((code) => rowsByCode.get(code));
        const visible = rows.some((row) => row && comparisonPassesFilter(row.same));
        return { target, sourceCodes, visible };
    }).filter((lane) => lane.visible);

    if (!lanes.length) return '';

    return `
        <section class="bracket-lane-section compare-lane-section">
            <h4>${title}</h4>
            <div class="bracket-lane-grid">
                ${lanes.map((lane) => {
        const sourceRows = lane.sourceCodes.map((code) => rowsByCode.get(code));
        const targetRow = rowsByCode.get(lane.target.code);

        return `
                    <article class="bracket-lane">
                        <div class="lane-source-stack">
                            ${sourceRows.map((row) => compareMatchCard(row, { muted: row && !comparisonPassesFilter(row.same) })).join('')}
                        </div>
                        <div class="lane-connector" aria-hidden="true"></div>
                        <div class="lane-target">
                            ${compareMatchCard(targetRow, { muted: targetRow && !comparisonPassesFilter(targetRow.same) })}
                        </div>
                    </article>
                `;
    }).join('')}
            </div>
        </section>
    `;
}

function renderCompareFinalLane(rowsByCode) {
    const sourceCodes = sourceMatchCodes('M104');
    const rows = [...sourceCodes, 'M104', 'M103'].map((code) => rowsByCode.get(code));
    if (!rows.some((row) => row && comparisonPassesFilter(row.same))) return '';

    return `
        <section class="bracket-lane-section compare-lane-section">
            <h4>Medal matches</h4>
            <div class="bracket-lane-grid bracket-lane-grid-final">
                <article class="bracket-lane">
                    <div class="lane-source-stack">
                        ${sourceCodes.map((code) => {
        const row = rowsByCode.get(code);
        return compareMatchCard(row, { muted: row && !comparisonPassesFilter(row.same) });
    }).join('')}
                    </div>
                    <div class="lane-connector" aria-hidden="true"></div>
                    <div class="lane-target lane-target-double">
                        ${['M104', 'M103'].map((code) => {
        const row = rowsByCode.get(code);
        return compareMatchCard(row, { muted: row && !comparisonPassesFilter(row.same) });
    }).join('')}
                    </div>
                </article>
            </div>
        </section>
    `;
}

function renderCompareBracket(rows) {
    const rowsByCode = compareRowsByCode(rows);
    const sections = [
        renderCompareLane('Round of 32 to Round of 16', 'r16', rowsByCode),
        renderCompareLane('Round of 16 to Quarterfinals', 'qf', rowsByCode),
        renderCompareLane('Quarterfinals to Semifinals', 'sf', rowsByCode),
        renderCompareFinalLane(rowsByCode),
    ].filter(Boolean);

    if (!sections.length) return '';

    return `
        <section class="compare-section">
            <h3>Knockout bracket</h3>
            <div class="bracket-lane-board">${sections.join('')}</div>
        </section>
    `;
}

function renderCompareOptions() {
    const options = rankedEntries()
        .map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`)
        .join('');

    compareASelect.innerHTML = options;
    compareBSelect.innerHTML = options;
    compareASelect.value = state.compareA;
    compareBSelect.value = state.compareB;
    compareFilterSelect.value = state.compareFilter;
}

function renderCompare() {
    const playerA = state.entries.find((entry) => entry.id === state.compareA);
    const playerB = state.entries.find((entry) => entry.id === state.compareB);

    if (!playerA || !playerB) {
        compareOutput.innerHTML = '<div class="empty-state">Choose two players to compare.</div>';
        return;
    }

    const allRows = compareRows(playerA, playerB);
    const filteredRows = allRows.filter((row) => comparisonPassesFilter(row.same));
    const shared = allRows.filter((row) => row.same).length;

    compareOutput.innerHTML = `
    <div class="compare-headline">
      <div><strong>${escapeHtml(playerA.name)}</strong><span>${playerA.score} pts</span></div>
            <div class="versus-chip">${shared}/${allRows.length || 0} same</div>
      <div><strong>${escapeHtml(playerB.name)}</strong><span>${playerB.score} pts</span></div>
    </div>
        ${renderCompareGroups(playerA, playerB)}
        ${renderCompareThird(allRows)}
        ${renderCompareBracket(allRows)}
        ${filteredRows.length ? '' : '<div class="empty-state">No picks match this comparison filter.</div>'}
  `;
}

function renderScoringRules() {
    scoringRulesContainer.innerHTML = Object.entries(BREAKDOWN_LABELS)
        .map(([key, label]) => `
    <article class="rule-card">
      <span>${label}</span>
      <strong>${state.rules?.[key] ?? 0} pts</strong>
    </article>
  `)
        .join('');
}

function render() {
    const entries = filteredEntries();
    renderSummary(rankedEntries());
    renderLeaderboard(entries);
    renderSelectedPlayer();
    renderCompare();
    renderScoringRules();
}

async function loadJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Unable to load ${path}`);
    return response.json();
}

async function loadData() {
    try {
        const [predictions, results, rules] = await Promise.all([
            loadJson(DATA_PATHS.predictions),
            loadJson(DATA_PATHS.results),
            loadJson(DATA_PATHS.rules),
        ]);

        state.source = predictions;
        state.results = results;
        state.rules = rules;
        state.matchStages = new Map(predictions.matches.map((match) => [match.code, match.stage]));
        state.teamsByCode = new Map(predictions.teams.map((team) => [normalizeCode(team.code), team]));
        state.entries = calculateScores(predictions, results, rules);

        const ranked = rankedEntries();
        state.selectedId = ranked[0]?.id || '';
        state.compareA = ranked[0]?.id || '';
        state.compareB = ranked[1]?.id || ranked[0]?.id || '';
        lastUpdatedLabel.textContent = `Updated ${results.updatedAt || 'recently'}`;
        renderCompareOptions();
        render();
    } catch (error) {
        console.error(error);
        lastUpdatedLabel.textContent = 'No local scoring data yet';
        state.entries = [];
        render();
    }
}

searchInput.addEventListener('input', (event) => {
    state.query = event.target.value;
    render();
});

sortBySelect.addEventListener('change', (event) => {
    state.sortBy = event.target.value;
    render();
});

sortDirectionSelect.addEventListener('change', (event) => {
    state.sortDirection = event.target.value;
    render();
});

leaderboardBody.addEventListener('click', (event) => {
    const row = event.target.closest('[data-player-id]');
    if (!row) return;

    state.selectedId = row.dataset.playerId;
    render();
    selectedPlayerContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

selectedPlayerContainer.addEventListener('click', (event) => {
    const filterButton = event.target.closest('[data-prediction-filter]');
    if (!filterButton) return;

    state.predictionFilter = filterButton.dataset.predictionFilter;
    renderSelectedPlayer();
});

compareASelect.addEventListener('change', (event) => {
    state.compareA = event.target.value;
    renderCompare();
});

compareBSelect.addEventListener('change', (event) => {
    state.compareB = event.target.value;
    renderCompare();
});

compareFilterSelect.addEventListener('change', (event) => {
    state.compareFilter = event.target.value;
    renderCompare();
});

loadData();