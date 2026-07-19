import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { SessionProvider } from './context/SessionContext';
import { PlayerFocusProvider } from './context/PlayerFocusContext';
import { Layout } from './components/Layout';
import { PlayerFocusModal } from './components/PlayerFocusModal';
import { HomePage } from './pages/HomePage';

// The authed pages pull in the app's heaviest deps (ag-grid, recharts, react-markdown), so
// they're split into on-demand chunks. A guest only loads Layout + HomePage; the big
// libraries arrive when the user actually opens Chat/Players/etc.
const ChatPage = lazy(() => import('./pages/ChatPage').then((m) => ({ default: m.ChatPage })));
const RostersPage = lazy(() =>
  import('./pages/RostersPage').then((m) => ({ default: m.RostersPage })),
);
const StatsPage = lazy(() => import('./pages/StatsPage').then((m) => ({ default: m.StatsPage })));
const TeamStatsPage = lazy(() =>
  import('./pages/TeamStatsPage').then((m) => ({ default: m.TeamStatsPage })),
);
const StandingsPage = lazy(() =>
  import('./pages/StandingsPage').then((m) => ({ default: m.StandingsPage })),
);
const MatchupsPage = lazy(() =>
  import('./pages/MatchupsPage').then((m) => ({ default: m.MatchupsPage })),
);
const MlbScoresPage = lazy(() =>
  import('./pages/MlbScoresPage').then((m) => ({ default: m.MlbScoresPage })),
);

export function App() {
  return (
    <SessionProvider>
      <PlayerFocusProvider>
        <Layout>
          <Suspense fallback={null}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/rosters" element={<RostersPage />} />
              <Route path="/scores" element={<MlbScoresPage />} />
              <Route path="/standings" element={<StandingsPage />} />
              <Route path="/matchups" element={<MatchupsPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/team-stats" element={<TeamStatsPage />} />
            </Routes>
          </Suspense>
        </Layout>
        <PlayerFocusModal />
      </PlayerFocusProvider>
    </SessionProvider>
  );
}
