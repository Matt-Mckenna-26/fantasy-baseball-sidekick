import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Placeholder } from './components/Placeholder';
import { HomePage } from './pages/HomePage';

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/chat"
          element={
            <Placeholder
              title="Co-Manager Chat"
              description="Ask the AI co-manager for advice on lineups, free agents, and trades."
            />
          }
        />
        <Route
          path="/rosters"
          element={
            <Placeholder title="Rosters" description="View team rosters across your league." />
          }
        />
        <Route
          path="/stats"
          element={
            <Placeholder
              title="Advanced Stats"
              description="Dig into advanced player and team stats."
            />
          }
        />
      </Routes>
    </Layout>
  );
}
