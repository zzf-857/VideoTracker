import React from 'react';

export default function App() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: 'radial-gradient(circle at center, #1e1b4b 0%, #0b0b0f 100%)',
      color: '#ffffff'
    }}>
      <h1 style={{
        fontSize: '3rem',
        fontWeight: 'bold',
        marginBottom: '1rem',
        background: 'linear-gradient(to right, #a78bfa, #818cf8)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent'
      }}>
        VideoTracker
      </h1>
      <p style={{ color: '#94a3b8', fontSize: '1.2rem' }}>
        您的视频学习进度跟踪与计时助手 (Beta 版)
      </p>
    </div>
  );
}
