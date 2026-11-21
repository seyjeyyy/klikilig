"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  MailOpen,
  Mail,
  Heart,
  RotateCw,
  LockKeyhole,
} from "lucide-react";
export function Steps() {
  return (
    <section className="steps">
      <h2>A photo date in three little steps</h2>
      <div>
        {[
          [Mail, "Invite your person", "Send a private link to your booth."],
          [Camera, "Take your photos", "Find a pose and click together."],
          [Heart, "Turn it over", "Open the notes you left each other."],
        ].map(([Icon, title, desc]) => {
          const I = Icon as typeof Mail;
          return (
            <article key={String(title)}>
              <span>
                <I size={24} />
              </span>
              <section>
                <h3>{String(title)}</h3>
                <p>{String(desc)}</p>
              </section>
            </article>
          );
        })}
      </div>
    </section>
  );
}
export default function Landing() {
  const [back, setBack] = useState(false);
  const sample = useRef<HTMLButtonElement>(null),
    turning = useRef(false);
  async function flip() {
    if (!sample.current || turning.current) return;
    turning.current = true;
    try {
      const effects = await import("@/lib/effects");
      await effects.flip(sample.current, () => setBack((v) => !v));
    } finally {
      turning.current = false;
    }
  }
  return (
    <>
      <main className="hero">
        <div className="heroCopy">
          <p className="eyebrow">
            <span /> A PRIVATE PHOTO BOOTH FOR TWO
          </p>
          <h1>
            Magkalayo man,
            <br />
            <em>isang klik lang.</em>
          </h1>
          <p className="support">A little photo date, wherever you are.</p>
          <p className="intro">
            Step into a private booth with your person. Take photos together,
            leave a secret note, and keep a little piece of today.
          </p>
          <div className="actions">
            <Link className="button primary" href="/dashboard?create=1">
              <Camera size={19} />
              Create a room
            </Link>
            <button className="secondary" onClick={flip}>
              <MailOpen size={18} />
              {back ? "See the front" : "Preview a postcard"}
            </button>
          </div>
          <p className="privacy">
            <LockKeyhole size={14} /> Invite-only. Two seats, just for you.
          </p>
        </div>
        <div className="art">
          <div className="envelope" aria-hidden="true">
            <i />
            <b />
          </div>
          <div className="letter">
            <div className="letterhead">
              POST CARD <Heart size={15} />
            </div>
            <p>
              To my favorite
              <br />
              person,
            </p>
            <p>
              Same time,
              <br />
              different places.
            </p>
            <span>Love, me ♡</span>
          </div>
          <button
            ref={sample}
            onClick={flip}
            className={"strip sample " + (back ? "reverse" : "")}
            aria-label="Flip sample postcard"
          >
            {back ? (
              <div className="backnote">
                <MailOpen />
                <h3>If you were here right now, I’d…</h3>
                <p>save the last photo for our silliest faces.</p>
                <i>Yours, always ♡</i>
              </div>
            ) : (
              <>
                {[1, 2, 3].map((n) => (
                  <img
                    key={n}
                    src={"/sample-" + n + ".webp"}
                    alt={"Sample photo booth pose " + n}
                  />
                ))}
                <strong>
                  Klikilig <Heart size={13} fill="currentColor" />
                </strong>
              </>
            )}
          </button>
          <small className="sampleLabel">
            <RotateCw size={13} /> Sample postcard
          </small>
        </div>
      </main>
      <Steps />
    </>
  );
}
