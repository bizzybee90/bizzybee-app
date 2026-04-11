WITH ranked_roles AS (
  SELECT
    ur.user_id,
    ur.role::text AS role,
    ROW_NUMBER() OVER (
      PARTITION BY ur.user_id
      ORDER BY CASE ur.role
        WHEN 'admin' THEN 3
        WHEN 'manager' THEN 2
        WHEN 'reviewer' THEN 1
        ELSE 0
      END DESC
    ) AS rank
  FROM public.user_roles ur
),
users_with_roles AS (
  SELECT
    u.id AS user_id,
    u.workspace_id,
    COALESCE(rr.role, 'member') AS role
  FROM public.users u
  LEFT JOIN ranked_roles rr
    ON rr.user_id = u.id
   AND rr.rank = 1
  WHERE u.workspace_id IS NOT NULL
)
INSERT INTO public.workspace_members (
  workspace_id,
  user_id,
  role,
  joined_at,
  updated_at
)
SELECT
  uwr.workspace_id,
  uwr.user_id,
  uwr.role,
  NOW(),
  NOW()
FROM users_with_roles uwr
WHERE NOT EXISTS (
  SELECT 1
  FROM public.workspace_members wm
  WHERE wm.workspace_id = uwr.workspace_id
    AND wm.user_id = uwr.user_id
);
