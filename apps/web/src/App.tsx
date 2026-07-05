import { Routes, Route } from 'react-router-dom';
import { SessionProvider } from './context/SessionContext';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { ChatPage } from './pages/ChatPage';
import { RostersPage } from './pages/RostersPage';
import { StatsPage } from './pages/StatsPage';
import { TeamStatsPage } from './pages/TeamStatsPage';
import { StandingsPage } from './pages/StandingsPage';
import { MatchupsPage } from './pages/MatchupsPage';

export function App() {
  return (
    <SessionProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/rosters" element={<RostersPage />} />
          <Route path="/standings" element={<StandingsPage />} />
          <Route path="/matchups" element={<MatchupsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/team-stats" element={<TeamStatsPage />} />
        </Routes>
      </Layout>
    </SessionProvider>
  );
}
