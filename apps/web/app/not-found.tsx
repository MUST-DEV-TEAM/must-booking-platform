import Link from 'next/link';

export default function NotFound() {
  return (
    <div
      style={{
        display: 'flex',
        minHeight: '60vh',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        textAlign: 'center',
        padding: '2rem',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Page not found</h1>
      <p style={{ color: '#6b7280' }}>
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Link href="/" style={{ textDecoration: 'underline' }}>
        Back to home
      </Link>
    </div>
  );
}
