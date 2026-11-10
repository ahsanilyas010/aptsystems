-- minimal pgTAP shim: plan, is, ok, lives_ok, throws_ok, finish (prints ok/not ok, fails the script on a failure)
create schema if not exists tap;
create table if not exists tap.res (n serial, ok boolean, descr text, detail text);
create or replace function plan(int) returns text language sql as $$ select 'plan'::text $$;
create or replace function ok(boolean, text default '') returns text language plpgsql as $$
begin insert into tap.res(ok, descr) values (coalesce($1,false), $2); return case when $1 then 'ok - '||$2 else 'NOT OK - '||$2 end; end $$;
create or replace function is(anyelement, anyelement, text default '') returns text language plpgsql as $$
begin insert into tap.res(ok, descr, detail) values ($1 is not distinct from $2, $3, format('got %s expected %s', $1, $2));
 return case when $1 is not distinct from $2 then 'ok - '||$3 else 'NOT OK - '||$3||format(' (got %s expected %s)', $1, $2) end; end $$;
create or replace function lives_ok(text, text default '') returns text language plpgsql as $$
begin execute $1; insert into tap.res(ok, descr) values (true, $2); return 'ok - '||$2;
exception when others then insert into tap.res(ok, descr, detail) values (false, $2, sqlerrm); return 'NOT OK - '||$2||' ('||sqlerrm||')'; end $$;
create or replace function throws_ok(text, text, text default null, text default '') returns text language plpgsql as $$
begin execute $1; insert into tap.res(ok, descr, detail) values (false, $4, 'no exception'); return 'NOT OK - '||$4||' (no exception)';
exception when others then
 insert into tap.res(ok, descr, detail) values (sqlstate = $2, $4, sqlstate||' '||sqlerrm);
 return case when sqlstate = $2 then 'ok - '||$4 else 'NOT OK - '||$4||' (got '||sqlstate||' '||sqlerrm||')' end; end $$;
create or replace function finish() returns text language plpgsql as $$
declare f int; t int; begin select count(*) filter (where not ok), count(*) into f, t from tap.res;
 if f > 0 then raise exception 'pgTAP shim: % of % tests failed', f, t; end if; return format('all %s tests passed', t); end $$;
grant usage on schema tap to public; grant all on tap.res to public; grant usage on all sequences in schema tap to public;
