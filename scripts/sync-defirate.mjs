import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const REST_URL = 'https://defirate.com/wp-json/wcb/v1';
const BRACKET_PAGE = 'https://defirate.com/bracket/';
const POOL_ID = process.argv[2] || 'lIzSQOL9';
const OUTPUT_FILE = process.argv[3] || 'data/predictions.json';

async function fetchJson(apiPath) {
    const response = await fetch(`${REST_URL}${apiPath}`, {
        headers: {
            accept: 'application/json',
            'user-agent': 'Mozilla/5.0 wc-predictor-sync',
        },
    });

    if (!response.ok) {
        throw new Error(`GET ${apiPath} failed with ${response.status}`);
    }

    return response.json();
}

function publicBracketUrl(publicId) {
    return `${BRACKET_PAGE}?bracket=${encodeURIComponent(publicId)}`;
}

function compactTeam(team) {
    if (!team) return null;

    return {
        id: String(team.id),
        code: team.code,
        name: team.name,
        group: team.group_letter,
        flagUrl: team.flag_url,
    };
}

function compactMatch(match) {
    return {
        code: match.match_code,
        stage: match.stage,
        group: match.group_letter || null,
        slotHome: match.slot_home,
        slotAway: match.slot_away,
    };
}

function normalizePicks(rawPicks, teamsById) {
    const group = {};
    const thirdAdvancers = [];
    const matches = {};
    let champion = null;

    for (const pick of rawPicks) {
        const team = compactTeam(teamsById.get(String(pick.picked_team_id)));

        if (pick.pick_type === 'group_finish') {
            group[pick.group_letter] ||= {};
            group[pick.group_letter][String(pick.rank_position)] = team;
            continue;
        }

        if (pick.pick_type === 'third_advances') {
            thirdAdvancers.push(pick.group_letter);
            continue;
        }

        if (pick.pick_type === 'match') {
            matches[pick.match_code] = team;
            continue;
        }

        if (pick.pick_type === 'champion') {
            champion = team;
        }
    }

    return {
        group,
        thirdAdvancers: thirdAdvancers.sort(),
        matches,
        champion,
    };
}

async function main() {
    const [poolData, tournamentData] = await Promise.all([
        fetchJson(`/pools/${POOL_ID}`),
        fetchJson('/tournament'),
    ]);

    const teamsById = new Map(tournamentData.teams.map((team) => [String(team.id), team]));
    const players = await Promise.all(
        poolData.rows.map(async (row) => {
            const bracketData = await fetchJson(`/brackets/${row.public_id}`);

            return {
                id: String(row.bracket_id),
                publicId: row.public_id,
                name: row.name,
                url: publicBracketUrl(row.public_id),
                joinedAt: row.joined_at,
                sourceScore: Number(row.score || 0),
                sourceCorrect: Number(row.picks_correct || 0),
                picks: normalizePicks(bracketData.picks || [], teamsById),
            };
        }),
    );

    const output = {
        syncedAt: new Date().toISOString(),
        source: {
            poolId: POOL_ID,
            poolUrl: `${BRACKET_PAGE}?pool=${encodeURIComponent(POOL_ID)}`,
            restUrl: REST_URL,
            scoring: 'Local scoring only. DeFiRate score and picks_correct are stored for reference, not used.',
        },
        pool: poolData.pool,
        teams: tournamentData.teams.map(compactTeam),
        matches: tournamentData.matches.map(compactMatch),
        players,
    };

    await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
    await writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`Wrote ${players.length} players to ${OUTPUT_FILE}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
