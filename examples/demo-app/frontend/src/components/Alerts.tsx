import { useEffect, useState } from 'react';
import axios from 'axios';

export default function Alerts() {
  const [alerts, setAlerts] = useState<{ id: number; title: string }[]>([]);
  useEffect(() => {
    axios.get('/api/alerts').then((res) => setAlerts(res.data));
  }, []);
  return <ul>{alerts.map((a) => <li key={a.id}>{a.title}</li>)}</ul>;
}
