insert into public.content_categories (name)
values ('Animation')
on conflict (name) do nothing;