import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; // Importaremos un CSS básico
import App from '../App'; // Asumimos que App.js está en la raíz

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
