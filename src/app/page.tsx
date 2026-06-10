"use client";

import dynamic from 'next/dynamic';

const AudioExtractor = dynamic(
  () => import('@/components/AudioExtractor'),
  { ssr: false }
);

export default function Home() {
  return <AudioExtractor />;
}
