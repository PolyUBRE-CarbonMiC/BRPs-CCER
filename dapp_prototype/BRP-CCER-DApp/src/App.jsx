import React from 'react';
import {
  Activity,
  BadgeCheck,
  Blocks,
  Building2,
  Calculator,
  CircleDollarSign,
  Database,
  FileCheck2,
  Gauge,
  Leaf,
  ShieldCheck,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { evidenceData } from './evidenceData';
import './App.css';

const COLORS = ['#1f7a5a', '#2563a8', '#c27803', '#6d7280'];

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function shortHash(value, size = 12) {
  if (!value || value === 'not captured') return 'not captured';
  if (value.length <= size * 2 + 3) return value;
  return `${value.slice(0, size)}...${value.slice(-size)}`;
}

function StatusPill({ children, tone = 'green' }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function Metric({ icon: Icon, label, value, note }) {
  return (
    <section className="metric-panel">
      <div className="metric-icon">
        <Icon size={22} />
      </div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{note}</span>
      </div>
    </section>
  );
}

export default function App() {
  const { project, network, metrics, emissions, revenue, tests } = evidenceData;

  const emissionChart = emissions.map((item) => ({
    unit: `U${item.unit_id}`,
    reduction: item.emission_reduction,
    type: item.energy_type,
  }));

  const revenueChart = revenue.map((item) => ({
    name: String(item.unit_id),
    value: Number(item.revenue),
  }));

  const passedTests = tests.filter((item) => item.status === 'Pass').length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Leaf size={26} />
          </div>
          <div>
            <h1>BRP-CCER DApp Prototype</h1>
            <p>Evidence-linked interface for building retrofit carbon-credit participation</p>
          </div>
        </div>
        <div className="network-strip">
          <StatusPill>Fabric PBFT</StatusPill>
          <span>Channel: {network.channel}</span>
          <span>Chaincode: {network.chaincode}</span>
        </div>
      </header>

      <section className="metric-grid">
        <Metric
          icon={Building2}
          label="Registered project"
          value={project.project_id}
          note={project.status}
        />
        <Metric
          icon={Calculator}
          label="CER output"
          value={formatNumber(metrics.total_reduction_gco2e)}
          note={`gCO2e (${metrics.total_reduction_tco2e.toFixed(4)} tCO2e)`}
        />
        <Metric
          icon={CircleDollarSign}
          label="Revenue allocated"
          value={formatNumber(metrics.total_revenue_cny, 2)}
          note={`CNY; FM ${formatNumber(metrics.fm_revenue_cny, 2)}`}
        />
        <Metric
          icon={ShieldCheck}
          label="Correctness tests"
          value={`${passedTests}/${tests.length}`}
          note="normal, query, and rejection checks"
        />
      </section>

      <section className="workspace">
        <aside className="project-panel">
          <div className="section-heading">
            <FileCheck2 size={20} />
            <h2>Project Registration</h2>
          </div>
          <dl className="project-list">
            <dt>Project ID</dt>
            <dd className="mono">{project.project_id}</dd>
            <dt>Name</dt>
            <dd>{project.project_name}</dd>
            <dt>Facility manager</dt>
            <dd>{project.facility_manager}</dd>
            <dt>Verifier</dt>
            <dd>{project.verifier}</dd>
            <dt>Registration date</dt>
            <dd>{project.registration_time}</dd>
          </dl>

          <div className="ledger-box">
            <div className="section-heading compact">
              <Blocks size={18} />
              <h3>Ledger Evidence</h3>
            </div>
            <div className="ledger-row">
              <span>Block height</span>
              <strong className="mono">{network.after_height || 'not captured'}</strong>
            </div>
            <div className="ledger-row">
              <span>Transaction ID</span>
              <strong className="mono">{shortHash(network.transaction_id, 14)}</strong>
            </div>
            <div className="ledger-row">
              <span>Current hash</span>
              <strong className="mono">{shortHash(network.current_block_hash, 10)}</strong>
            </div>
            <div className="ledger-row">
              <span>Previous hash</span>
              <strong className="mono">{shortHash(network.previous_block_hash, 10)}</strong>
            </div>
          </div>
        </aside>

        <section className="main-grid">
          <article className="panel wide">
            <div className="panel-head">
              <div className="section-heading">
                <Gauge size={20} />
                <h2>Smart-contract Correctness Matrix</h2>
              </div>
              <StatusPill>{passedTests} passed</StatusPill>
            </div>
            <div className="test-grid">
              {tests.map((item) => (
                <div className="test-item" key={item.id}>
                  <div className="test-id mono">{item.id}</div>
                  <div>
                    <strong>{item.test}</strong>
                    <p>{item.observed}</p>
                  </div>
                  <BadgeCheck size={22} className={item.status === 'Pass' ? 'ok' : 'muted'} />
                </div>
              ))}
            </div>
          </article>

          <article className="panel chart-panel">
            <div className="panel-head">
              <div className="section-heading">
                <Activity size={20} />
                <h2>Unit-level CER</h2>
              </div>
              <span className="subtle">{emissions.length} units</span>
            </div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={emissionChart} margin={{ top: 8, right: 8, left: 6, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="unit" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} width={58} />
                  <Tooltip formatter={(value) => [`${formatNumber(value)} gCO2e`, 'Reduction']} />
                  <Bar dataKey="reduction" radius={[4, 4, 0, 0]} fill="#1f7a5a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="panel chart-panel">
            <div className="panel-head">
              <div className="section-heading">
                <CircleDollarSign size={20} />
                <h2>Revenue Allocation</h2>
              </div>
              <span className="subtle">CNY 100 input</span>
            </div>
            <div className="split-chart">
              <ResponsiveContainer width="45%" height="100%">
                <PieChart>
                  <Pie data={revenueChart} dataKey="value" nameKey="name" outerRadius={84} innerRadius={48}>
                    {revenueChart.map((entry, index) => (
                      <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [`${formatNumber(value, 2)} CNY`, 'Revenue']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="revenue-list">
                {revenue.slice(0, 6).map((item) => (
                  <div key={item.unit_id} className="revenue-row">
                    <span className="mono">{item.unit_id}</span>
                    <strong>{formatNumber(item.revenue, 2)}</strong>
                  </div>
                ))}
                <div className="revenue-row muted-row">
                  <span>Other units</span>
                  <strong>{formatNumber(revenue.slice(6).reduce((sum, item) => sum + Number(item.revenue), 0), 2)}</strong>
                </div>
              </div>
            </div>
          </article>

          <article className="panel wide">
            <div className="panel-head">
              <div className="section-heading">
                <Database size={20} />
                <h2>On-chain Query Outputs</h2>
              </div>
              <span className="subtle">Fabric CLI evidence summary</span>
            </div>
            <table className="evidence-table">
              <thead>
                <tr>
                  <th>Function</th>
                  <th>Observed ledger result</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tests.slice(0, 6).map((item) => (
                  <tr key={item.id}>
                    <td>{item.test}</td>
                    <td>{item.observed}</td>
                    <td><StatusPill>{item.status}</StatusPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </section>
      </section>
    </main>
  );
}
