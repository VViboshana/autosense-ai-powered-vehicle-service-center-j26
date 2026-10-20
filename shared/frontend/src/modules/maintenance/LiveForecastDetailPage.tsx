import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Alert } from '@/components/ui/Form';
import { Card } from '@/components/ui/Card';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { ApiError } from '@/lib/api';
import { PageHeader } from '@/layout/PageHeader';
import { estimateMaintenanceDuration, getForecast } from './maintenance.api';
import type { MaintenanceForecast } from './maintenance.types';
import { ForecastSourcesCard, LiveBadge } from './MaintenanceComponents';
import './maintenance.css';

export function LiveForecastDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const initial = (location.state as { forecast?: MaintenanceForecast } | null)?.forecast;
  const [forecast, setForecast] = useState<MaintenanceForecast | undefined>(initial);
  const [missing, setMissing] = useState(false);
  const [selectedTask, setSelectedTask] = useState('');
  const [duration, setDuration] = useState<Awaited<ReturnType<typeof estimateMaintenanceDuration>>>();
  const [durationBusy, setDurationBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!initial) getForecast(id).then((value) => value ? setForecast(value) : setMissing(true));
  }, [id, initial]);

  if (missing) return <><PageHeader title="Forecast unavailable" /><div className="app-content"><div className="container-fluid"><EmptyState title="This forecast could not be found" action={<Link className="btn btn-light" to="/maintenance/forecasts">Back to forecasts</Link>} /></div></div></>;
  if (!forecast) return <><PageHeader title="Forecast" /><div className="app-content"><div className="container-fluid p-4"><Skeleton width="18rem" /></div></div></>;

  const tasks = forecast.candidateTasks ?? [];
  const durationStatus = duration?.status ?? forecast.durationStatus;
  const estimatedHours = duration?.duration.estimatedHours ?? forecast.durationHours;
  const estimatedMinutes = duration?.duration.estimatedMinutes ?? forecast.durationMinutes;

  async function estimateSelectedTask() {
    if (!selectedTask) return;
    setDurationBusy(true);
    setError('');
    try {
      setDuration(await estimateMaintenanceDuration(selectedTask));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) setError('The selected repair task is no longer available.');
      else if (cause instanceof ApiError && cause.status === 503) setError('Maintenance prediction service is temporarily unavailable.');
      else if (cause instanceof ApiError && cause.status === 504) setError('Maintenance prediction is taking longer than expected. Please try again.');
      else setError('Unable to estimate service duration right now.');
    } finally {
      setDurationBusy(false);
    }
  }

  return <>
    <PageHeader title={`Forecast ${forecast.id}`} subtitle={`${forecast.registrationNo} · ${forecast.vehicle} · ${forecast.mileage.toLocaleString()} km`} documentTitle={forecast.id} actions={<><LiveBadge /><Link className="btn btn-light" to="/maintenance/forecasts">Back to forecasts</Link></>} />
    <div className="app-content"><div className="container-fluid"><div className="row g-3">
      <div className="col-xl-8">
        <Card icon="bi-magic" title="AI maintenance forecast" subtitle="Model output supports technician decision-making and should be reviewed before work is approved.">
          <div className="p-3 pt-0"><div className="as-result-grid"><div><small>Maintenance required</small><strong className="text-body-secondary">Not evaluated</strong></div><div><small>Predicted category</small><strong>{forecast.category}</strong></div><div><small>Model score</small><strong>{(forecast.modelScore * 100).toFixed(1)}%</strong></div></div></div>
        </Card>
        <Card title="Category scores" subtitle="Relative model output across maintenance categories."><div className="p-3 pt-0">{forecast.categoryScores.map((item) => <div className="as-category-score" key={item.label}><span>{item.label}</span><div className="as-score-track"><i className={item.label === forecast.category ? 'selected' : ''} style={{ width: `${item.score * 100}%` }} /></div><b>{item.score.toFixed(2)}</b></div>)}</div></Card>
        <Card icon="bi-list-check" title="Candidate repair tasks" subtitle="Select one task explicitly before requesting a labor-duration estimate.">
          <div className="p-3 pt-0">{tasks.length ? <><div className="list-group">{tasks.map((task) => <label className={`list-group-item list-group-item-action d-flex gap-2 align-items-start ${selectedTask === task.fixTitle ? 'active' : ''}`} key={task.fixTitle}><input className="form-check-input mt-1" type="radio" name="candidate-task" value={task.fixTitle} checked={selectedTask === task.fixTitle} onChange={() => setSelectedTask(task.fixTitle)} /><span><b>{task.fixTitle}</b><small className="d-block">{task.difficultyLevel} · catalogue rank {task.probabilityRank}</small></span></label>)}</div><div className="d-flex align-items-center gap-3 mt-3"><button className="btn btn-primary" type="button" disabled={!selectedTask || durationBusy} onClick={estimateSelectedTask}>{durationBusy ? 'Estimating labor duration...' : 'Estimate service duration'}</button>{!duration && <span className="small text-body-secondary">Select a repair task to estimate duration.</span>}</div>{error && <Alert>{error}</Alert>}</> : <p className="small text-body-secondary mb-0">No catalogue repair tasks are currently mapped to this predicted category.</p>}</div>
        </Card>
        <Card icon="bi-hourglass-split" title="Estimated labor duration"><div className="p-3 pt-0"><b>{durationStatus === 'awaiting_task_selection' && !duration ? 'Awaiting task selection' : estimatedMinutes == null ? 'Not available yet' : `${estimatedMinutes} minutes (${estimatedHours ?? '—'} hours)`}</b><p className="small text-body-secondary mt-2 mb-0">{durationStatus === 'awaiting_task_selection' && !duration ? 'Select a repair task to estimate duration.' : 'Duration is a benchmark estimate based on estimated labor-hour data.'}</p>{duration && <span className="as-badge mt-2">{duration.model.variant}</span>}</div></Card>
      </div>
      <div className="col-xl-4"><ForecastSourcesCard forecast={forecast} /><Card icon="bi-clipboard-check" title="Forecast status"><div className="p-3 pt-0"><dl className="as-detail-list"><dt>Task selection</dt><dd>{forecast.taskSelection?.required ? 'Required' : 'Not required'}</dd><dt>Duration</dt><dd>{durationStatus === 'awaiting_task_selection' ? 'Awaiting task selection' : durationStatus}</dd><dt>Maintenance required</dt><dd>Not evaluated</dd><dt>Assessment</dt><dd>{forecast.assessmentType ?? 'Enriched'}</dd></dl></div></Card></div>
    </div></div></div>
  </>;
}
