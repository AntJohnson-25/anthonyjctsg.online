/* Mailing list + game reactions, talking straight to Supabase.
 *
 * The key below is the publishable one and is meant to ship in public source.
 * Row Level Security grants the anon role insert-only access, so the worst a
 * reader of this file can do is add a row — not read the email list.
 *
 * No SDK on purpose: a CDN <script> would be a third-party dependency and an
 * extra request on every page, and this is about forty lines of fetch. */
(function (global) {
    'use strict';

    var URL_BASE = 'https://tgpifrhkksycjtwymoxx.supabase.co';
    var API_KEY = 'sb_publishable_nc5cZW4r3Cp3VcL0DqwZSQ_vcIW2prZ';

    /* Which site an event came from. The games run on both anthonyjctsg.com
     * and anthonyjctsg.online, and both write to the same table, so the rows
     * are indistinguishable without this.
     *
     * Read from the hostname rather than hard-coded, so this file stays byte
     * for byte identical in both repos. game_events has a check constraint on
     * the column, and an unlisted value would fail the insert — hence the
     * whitelist and the fallback, which covers file:// and localhost while
     * testing. */
    function site() {
        var host = '';
        try { host = (global.location.hostname || '').replace(/^www\./, ''); }
        catch (e) { /* no location worth reading */ }
        return (host === 'anthonyjctsg.online') ? 'anthonyjctsg.online' : 'anthonyjctsg.com';
    }

    /* A random id kept in localStorage. Not a login and not tied to a person —
     * it exists only so one browser cannot heart the same game repeatedly. */
    function visitorId() {
        var KEY = 'ctsg_visitor_id';
        var id = null;
        try { id = global.localStorage.getItem(KEY); } catch (e) { /* private mode */ }
        if (!id) {
            id = (global.crypto && global.crypto.randomUUID)
                ? global.crypto.randomUUID()
                /* Pre-2021 browsers: good enough for a dedupe key. */
                : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                    var r = Math.random() * 16 | 0;
                    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
                });
            try { global.localStorage.setItem(KEY, id); } catch (e) { /* private mode */ }
        }
        return id;
    }

    /* Duplicates are left to the unique indexes and handled by the 409 below.
     * PostgREST's resolution=ignore-duplicates looks like the tidier option but
     * is rejected by RLS on an insert-only table, so this is the working path. */
    function insert(table, row) {
        return fetch(URL_BASE + '/rest/v1/' + table, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': API_KEY,
                'Authorization': 'Bearer ' + API_KEY,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(row)
        }).then(function (res) {
            /* 409 means the unique index caught a repeat. For a reaction or a
             * returning subscriber that is the expected outcome, not an error. */
            if (res.ok || res.status === 409) { return { ok: true, duplicate: res.status === 409 }; }
            return res.text().then(function (body) {
                throw new Error('Supabase ' + res.status + ': ' + body);
            });
        });
    }

    global.CTSG = {
        visitorId: visitorId,

        /* Fire-and-forget: analytics must never block a click or surface an
         * error to someone who just wanted to play a game. */
        track: function (gameSlug, eventType) {
            insert('game_events', {
                game_slug: gameSlug,
                event_type: eventType,
                visitor_id: visitorId(),
                site: site()
            })['catch'](function () { /* offline, blocked, whatever */ });
        },

        signUp: function (email, name, source) {
            return insert('signups', {
                email: email,
                name: name || null,
                source: source || null
            });
        },

        contact: function (fields) {
            return insert('recruiter_inquiries', {
                name: fields.name,
                email: fields.email,
                company: fields.company || null,
                role_title: fields.role || null,
                message: fields.message
            });
        },

        reactionCounts: function () {
            return fetch(URL_BASE + '/rest/v1/rpc/game_reaction_counts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': API_KEY,
                    'Authorization': 'Bearer ' + API_KEY
                },
                body: '{}'
            }).then(function (res) {
                return res.ok ? res.json() : [];
            })['catch'](function () { return []; });
        }
    };
}(window));
