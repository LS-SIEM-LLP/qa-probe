import { useEffect, useState } from 'react';
import axios from 'axios';

export default function Settings() {
  const [name, setName] = useState('');
  useEffect(() => {
    axios.get('/api/settings').then((res) => setName(res.data.displayName));
  }, []);
  return <div>{name}</div>;
}
