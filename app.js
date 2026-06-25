const state = {
    entries: [],
    sortBy: 'score',
    sortDirection: 'desc',
    query: '',
};

const leaderboardBody = document.getElementById('leaderboard-body');
const top3Container = document.getElementById('top3');
const summaryContainer = document.getElementById('summary');
const searchInput = document.getElementById('search');
const sortBySelect = document.getElementById('sort-by');
const sortDirectionSelect = document.getElementById('sort-direction');
const lastUpdatedLabel = document.getElementById('last-updated');

function compareValues(a, b) {
    const direction = state.sortDirection === 'asc' ? 1 : -1;

    if (state.sortBy === 'name') {
        return a.name.localeCompare(b.name) * direction;
    }

    const aValue = a[state.sortBy] ?? 0;
    const bValue = b[state.sortBy] ?? 0;

    if (aValue === bValue) {
        return a.rank - b.rank;
    }

    return (aValue > bValue ? 1 : -1) * direction;
}

function filteredEntries() {
    const query = state.query.trim().toLowerCase();
    return state.entries
        .filter((entry) => entry.name.toLowerCase().includes(query))
        .sort(compareValues);
}

function renderTop3(entries) {
    const top = entries.slice(0, 3);
    top3Container.innerHTML = top
        .map((entry, index) => {
            const classes = ['top-card', index === 0 ? 'gold' : index === 1 ? 'silver' : 'bronze'];
            return `
        <article class="${classes.join(' ')}">
          <div class="rank-badge">${index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}</div>
          <strong>${entry.name}</strong>
          <div class="meta">${entry.score} pts • ${entry.correct} correct</div>
        </article>
      `;
        })
        .join('');
}

function renderSummary(entries) {
    if (!entries.length) {
        summaryContainer.innerHTML = '<div class="summary-card"><strong>No matches</strong><span>No players match your search.</span></div>';
        return;
    }

    const topEntry = entries[0];
    const averageScore = Math.round(entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length);
    const maxCorrect = Math.max(...entries.map((entry) => entry.correct));

    summaryContainer.innerHTML = `
    <div class="summary-card">
      <span>Leader</span>
      <strong>${topEntry.name}</strong>
    </div>
    <div class="summary-card">
      <span>Average score</span>
      <strong>${averageScore}</strong>
    </div>
    <div class="summary-card">
      <span>Best correct picks</span>
      <strong>${maxCorrect}</strong>
    </div>
  `;
}

function renderLeaderboard(entries) {
    if (!entries.length) {
        leaderboardBody.innerHTML = '<tr><td colspan="5">No players found.</td></tr>';
        return;
    }

    leaderboardBody.innerHTML = entries
        .map((entry) => {
            const width = Math.min(100, Math.round((entry.score / 10) * 100));
            return `
        <tr>
          <td class="rank-cell">#${entry.rank}</td>
          <td class="player-cell">
            <strong>${entry.name}</strong>
            <span>${entry.note || 'Freshly added'}</span>
          </td>
          <td>${entry.score}</td>
          <td>${entry.correct}</td>
          <td>
            <div class="bar">
              <span style="width:${width}%"></span>
            </div>
          </td>
        </tr>
      `;
        })
        .join('');
}

function render() {
    const entries = filteredEntries();
    renderTop3(entries);
    renderSummary(entries);
    renderLeaderboard(entries);
}

async function loadData() {
    try {
        const response = await fetch('./data/leaderboard.json');
        if (!response.ok) throw new Error('Unable to load data');
        const data = await response.json();
        state.entries = data.map((entry, index) => ({
            ...entry,
            rank: entry.rank || index + 1,
        }));
        lastUpdatedLabel.textContent = `Updated ${data[0]?.updatedAt || 'recently'}`;
        render();
    } catch (error) {
        console.error(error);
        lastUpdatedLabel.textContent = 'No fresh data yet';
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

loadData();
