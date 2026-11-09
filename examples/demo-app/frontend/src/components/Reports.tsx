import { useEffect, useState } from 'react';
import axios from 'axios';

export default function Reports() {
  const [reports, setReports] = useState<unknown[]>([]);
  useEffect(() => {
    axios.get('/api/reports').then((res) => setReports(res.data));
  }, []);
  return <div>{reports.length} reports</div>;
}
