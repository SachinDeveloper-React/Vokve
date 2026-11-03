import { z } from 'zod';
import { equipmentSchema, muscleGroupSchema } from '../../contracts/index.js';
import { Errors } from '../../lib/errors.js';
import { AuditLogModel } from '../platform/models.js';
import { ExerciseModel, WorkoutModel, WorkoutTemplateModel } from '../training/models.js';
import { limitField, offsetField } from './paging.js';

/**
 * The gym's own content, for the operator: the exercise list and the
 * workout templates built out of it.
 *
 * Both were seed data, and both are read live by the app — the template
 * carousel on the workout screen and the exercise picker behind it. Adding
 * a lift meant a deploy.
 *
 * The one relationship worth being careful about is `exerciseIds` on a
 * template: an id that is not in the exercise list is a row the app's
 * template contract will refuse, because a template carries whole exercises
 * rather than ids. So a template is checked against the list on the way in,
 * and an exercise a template uses is not deleted without saying so.
 *
 * A finished workout is a member's own record and is never touched here: it
 * carries its own copy of what was done, so correcting an exercise's name
 * or its muscle group changes the catalogue from now on and leaves every
 * workout already logged exactly as it was.
 */

const MUSCLE_GROUPS = muscleGroupSchema.options;
const EQUIPMENT = equipmentSchema.options;

const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;

/** What somebody typed into a search box, as a literal rather than a pattern. */
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `Barbell Bench Press` → `barbell-bench-press`. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

// ─── Exercises ─────────────────────────────────────────────────────────────

export const exerciseBody = z
  .object({
    /** The id a template names and a logged set keeps. Written from the name when left out. */
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, 'An id looks like barbell-bench-press').optional(),
    name: z.string().trim().min(1).max(80),
    muscleGroup: z.enum(MUSCLE_GROUPS),
    equipment: z.enum(EQUIPMENT),
    /** Cardio work is timed; a lift is counted in reps. */
    isTimed: z.boolean().optional(),
    imageUrl: z.string().trim().max(500).nullable().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type ExerciseBody = z.infer<typeof exerciseBody>;

export const exercisePatch = exerciseBody.partial().omit({ id: true }).strict();
export type ExercisePatch = z.infer<typeof exercisePatch>;

export const templateBody = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, 'An id looks like push-day').optional(),
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(400).optional(),
    estimatedMinutes: z.number().int().min(1).max(600),
    /** What it works, for the card. Derived from its exercises when left out. */
    muscleGroups: z.array(z.enum(MUSCLE_GROUPS)).max(10).optional(),
    /** In the order they are performed. Every one has to be a real exercise. */
    exerciseIds: z.array(z.string().trim().min(1).max(64)).min(1).max(40),
    sort: z.number().int().min(-10_000).max(10_000).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type TemplateBody = z.infer<typeof templateBody>;

export const templatePatch = templateBody.partial().omit({ id: true }).strict();
export type TemplatePatch = z.infer<typeof templatePatch>;

const audit = (actor: string, action: string, subjectType: string, subjectId: string, before: unknown, after: unknown) =>
  AuditLogModel.create({ actorType: 'admin', actorId: actor, action, subjectType, subjectId, before, after });

/**
 * The gym, in one read: every exercise, every template, and what each is
 * used by.
 *
 * `templates` on an exercise is the column that decides whether it can be
 * deleted, and `logged` is the one that says whether anybody is doing it —
 * an exercise in no template and in nobody's workouts is one that was typed
 * and forgotten.
 */
export const trainingQuery = z.object({
  /**
   * Two lists in one answer, so two of everything.
   *
   * The gym is exercises *and* the templates built out of them, read
   * together because each decides what can be done to the other — a
   * template naming a missing exercise is one the app drops, and an
   * exercise a template uses is not deleted without saying so. One
   * `offset` cannot mean both, so each list has its own, and a link an
   * operator was sent still says which page of which.
   */
  exerciseQ: z.string().max(120).default(''),
  muscleGroup: z.enum(MUSCLE_GROUPS).optional(),
  equipment: z.enum(EQUIPMENT).optional(),
  exerciseState: z.enum(['any', 'unused', 'logged']).default('any'),
  exerciseLimit: limitField(25, 100),
  exerciseOffset: offsetField(),

  templateQ: z.string().max(120).default(''),
  templateState: z.enum(['any', 'broken']).default('any'),
  templateLimit: limitField(25, 100),
  templateOffset: offsetField(),
});
export type TrainingQuery = z.infer<typeof trainingQuery>;

const WHOLE_GYM: TrainingQuery = {
  exerciseQ: '',
  exerciseState: 'any',
  exerciseLimit: 25,
  exerciseOffset: 0,
  templateQ: '',
  templateState: 'any',
  templateLimit: 25,
  templateOffset: 0,
};

export async function listTraining(query: TrainingQuery = WHOLE_GYM) {
  const exerciseFilter: Record<string, unknown> = {};
  const exerciseWords = query.exerciseQ.trim();
  if (exerciseWords) {
    const like = new RegExp(escape(exerciseWords), 'i');
    exerciseFilter.$or = [{ _id: like }, { name: like }];
  }
  if (query.muscleGroup) exerciseFilter.muscleGroup = query.muscleGroup;
  if (query.equipment) exerciseFilter.equipment = query.equipment;

  const templateFilter: Record<string, unknown> = {};
  const templateWords = query.templateQ.trim();
  if (templateWords) {
    const like = new RegExp(escape(templateWords), 'i');
    templateFilter.$or = [{ _id: like }, { title: like }, { description: like }];
  }

  /**
   * The three id sets both halves of this answer need, read once.
   *
   * "Unused", "logged" and "broken" are each a question about the *other*
   * collection, and each is asked both by a filter and by a tally above the
   * table. Asked once here and reused rather than twice: the logged set is
   * a pass over every workout ever finished, which is the one read on this
   * page that grows with the members rather than with the catalogue.
   */
  const [known, inTemplates, everLogged] = await Promise.all([
    ExerciseModel.distinct('_id'),
    WorkoutTemplateModel.distinct('exerciseIds'),
    WorkoutModel.distinct('exercises.exerciseId', { deletedAt: null }),
  ]);
  const touched = [...new Set([...inTemplates, ...everLogged])];

  if (query.exerciseState !== 'any') {
    exerciseFilter._id = query.exerciseState === 'logged' ? { $in: everLogged } : { $nin: touched };
  }
  if (query.templateState === 'broken') {
    templateFilter.exerciseIds = { $elemMatch: { $nin: known } };
  }

  const [exercises, exerciseTotal, templates, templateTotal, totals] = await Promise.all([
    ExerciseModel.find(exerciseFilter)
      .sort({ muscleGroup: 1, name: 1 })
      .skip(query.exerciseOffset)
      .limit(query.exerciseLimit)
      .lean(),
    ExerciseModel.countDocuments(exerciseFilter),
    WorkoutTemplateModel.find(templateFilter)
      .sort({ sort: 1, _id: 1 })
      .skip(query.templateOffset)
      .limit(query.templateLimit)
      .lean(),
    WorkoutTemplateModel.countDocuments(templateFilter),
    gymTotals(known, touched),
  ]);

  const exerciseIds = exercises.map(row => String(row._id));
  const templateIds = [...new Set(templates.flatMap(row => row.exerciseIds ?? []))];

  const [logged, usingThem, namesForTemplates] = await Promise.all([
    // Logged sets, for the exercises on this page. Unwinding every workout
    // ever finished to decorate twenty-five rows is the read this replaces.
    WorkoutModel.aggregate<{ _id: string; sessions: number; members: string[]; lastAt: Date }>([
      { $match: { deletedAt: null, 'exercises.exerciseId': { $in: exerciseIds } } },
      { $unwind: '$exercises' },
      { $match: { 'exercises.exerciseId': { $in: exerciseIds } } },
      {
        $group: {
          _id: '$exercises.exerciseId',
          sessions: { $sum: 1 },
          members: { $addToSet: '$userId' },
          lastAt: { $max: '$startedAt' },
        },
      },
    ]),
    // The templates that include them, by name — the column that decides
    // whether an exercise can be deleted.
    WorkoutTemplateModel.find({ exerciseIds: { $in: exerciseIds } }, { title: 1, exerciseIds: 1 }).lean(),
    // And the names the templates on *their* page need, in their order.
    ExerciseModel.find({ _id: { $in: templateIds } }, { name: 1 }).lean(),
  ]);

  const loggedOf = new Map(logged.map(row => [row._id, row]));
  const nameOf = new Map(namesForTemplates.map(row => [String(row._id), row.name]));

  const exerciseRows = exercises.map(row => {
    const used = usingThem.filter(template => (template.exerciseIds ?? []).includes(row._id));
    const use = loggedOf.get(row._id);
    return {
      id: row._id,
      name: row.name ?? row._id,
      muscleGroup: row.muscleGroup ?? 'full_body',
      equipment: row.equipment ?? 'none',
      isTimed: row.isTimed === true,
      imageUrl: row.imageUrl ?? null,
      /** The templates that include it, by name. */
      templates: used.map(template => ({ id: template._id, title: template.title ?? template._id })),
      /** Logged sets, and the members who did them. */
      logged: {
        sessions: use?.sessions ?? 0,
        members: use?.members.length ?? 0,
        lastAt: iso(use?.lastAt ?? null),
      },
    };
  });

  const templateRows = templates.map(row => {
    const ids = row.exerciseIds ?? [];
    const missing = ids.filter(id => !nameOf.has(id));
    return {
      id: row._id,
      title: row.title ?? row._id,
      description: row.description ?? '',
      estimatedMinutes: row.estimatedMinutes ?? 30,
      muscleGroups: row.muscleGroups ?? [],
      exerciseIds: ids,
      /** Each one's name, in the order they are performed. */
      exercises: ids.map(id => ({ id, name: nameOf.get(id) ?? null })),
      /**
       * Ids no exercise answers to. The app's template contract carries whole
       * exercises, so a template with one of these is one the app drops.
       */
      missing,
      sort: row.sort ?? 0,
    };
  });

  return {
    muscleGroups: MUSCLE_GROUPS,
    equipment: EQUIPMENT,
    /** Of the whole gym, whatever these two pages are showing. */
    totals,
    /** How many each filter matches, of which each list is one page. */
    exercisePage: { total: exerciseTotal, limit: query.exerciseLimit, offset: query.exerciseOffset },
    templatePage: { total: templateTotal, limit: query.templateLimit, offset: query.templateOffset },
    exercises: exerciseRows,
    templates: templateRows,
    nextCursor: null,
  };
}

/**
 * Every exercise by name alone, for the picker.
 *
 * A template is built by choosing exercises in order, so that form needs
 * the whole list — the one thing a paged list cannot give it. This is the
 * same collection with four fields per row and no joins, which is a few
 * kilobytes where the full list is two reads per row.
 */
export async function exercisePicker() {
  const rows = await ExerciseModel.find({}, { name: 1, muscleGroup: 1, equipment: 1, isTimed: 1 })
    .sort({ muscleGroup: 1, name: 1 })
    .lean();
  return {
    total: rows.length,
    data: rows.map(row => ({
      id: String(row._id),
      name: row.name ?? String(row._id),
      muscleGroup: row.muscleGroup ?? 'full_body',
      equipment: row.equipment ?? 'none',
      isTimed: row.isTimed === true,
    })),
  };
}

/**
 * The five figures above the two tables, each of the whole gym.
 *
 * "6 broken templates" has to mean six templates the app will refuse, not
 * six on this screen. `known` and `touched` come from the caller because
 * the filters above need the same two sets, and reading them twice would
 * mean two passes over every workout ever finished.
 */
async function gymTotals(known: string[], touched: string[]) {
  const [exercises, templates, broken, unused, sessions] = await Promise.all([
    ExerciseModel.countDocuments({}),
    WorkoutTemplateModel.countDocuments({}),
    WorkoutTemplateModel.countDocuments({ exerciseIds: { $elemMatch: { $nin: known } } }),
    ExerciseModel.countDocuments({ _id: { $nin: touched } }),
    WorkoutModel.countDocuments({ deletedAt: null }),
  ]);

  return {
    exercises,
    templates,
    /** Templates the app will refuse: they name an exercise that is not there. */
    broken,
    /** Typed and forgotten: in no template, and in nobody's workouts. */
    unused,
    sessions,
  };
}

export async function createExercise(actor: string, body: ExerciseBody) {
  const id = body.id ?? slugify(body.name);
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(id)) {
    throw Errors.validation({ id: `“${body.name}” does not make an id — type one, like barbell-bench-press.` });
  }
  if (await ExerciseModel.exists({ _id: id })) {
    throw Errors.validation({ id: `There is already a “${id}” exercise.` });
  }

  await ExerciseModel.create({
    _id: id,
    name: body.name,
    muscleGroup: body.muscleGroup,
    equipment: body.equipment,
    isTimed: body.isTimed === true,
    imageUrl: body.imageUrl ?? null,
  });
  await audit(actor, 'exercise.created', 'exercise', id, null, { ...body, id, note: body.note ?? null });
  return { created: true, ...(await listTraining()) };
}

/**
 * Changes one.
 *
 * Correcting a name or a muscle group never rewrites a workout anybody has
 * logged: a finished set carries its own copy of what it was.
 */
export async function updateExercise(actor: string, id: string, body: ExercisePatch) {
  const before = await ExerciseModel.findById(id).lean();
  if (!before) throw Errors.notFound('That exercise');
  const { note, ...fields } = body;
  if (Object.keys(fields).length === 0) throw Errors.validation({ name: 'Nothing to change.' });

  await ExerciseModel.updateOne({ _id: id }, { $set: fields });
  await audit(actor, 'exercise.updated', 'exercise', id, { name: before.name, muscleGroup: before.muscleGroup, equipment: before.equipment }, { ...fields, note: note ?? null });
  return listTraining();
}

/**
 * Deletes an exercise.
 *
 * Refused while a template names it: the app's template contract carries
 * whole exercises, so the template would arrive with a hole in it and be
 * dropped on the phone. Take it out of the templates first — the refusal
 * says which ones.
 *
 * Workouts already logged are not a reason to refuse: each one keeps its own
 * copy of what was done, so they stay readable either way.
 */
export async function deleteExercise(actor: string, id: string, note?: string) {
  const before = await ExerciseModel.findById(id).lean();
  if (!before) throw Errors.notFound('That exercise');

  const templates = await WorkoutTemplateModel.find({ exerciseIds: id }, { title: 1 }).lean();
  if (templates.length > 0) {
    throw Errors.validation({
      id: `${templates.map(template => template.title ?? template._id).join(', ')} include${templates.length === 1 ? 's' : ''} this exercise. Take it out of ${templates.length === 1 ? 'that template' : 'those templates'} first — the app drops a template that names an exercise it cannot find.`,
    });
  }

  await ExerciseModel.deleteOne({ _id: id });
  await audit(actor, 'exercise.deleted', 'exercise', id, { name: before.name, muscleGroup: before.muscleGroup }, { deleted: true, note: note ?? null });
  return { deleted: true, id, ...(await listTraining()) };
}

// ─── Workout templates ─────────────────────────────────────────────────────

/** Every id a template names has to be a real exercise, or the app drops the template. */
async function assertExercises(ids: string[]): Promise<string[]> {
  const found = await ExerciseModel.find({ _id: { $in: ids } }, { _id: 1 }).lean();
  const have = new Set(found.map(row => row._id));
  const missing = ids.filter(id => !have.has(id));
  if (missing.length > 0) {
    throw Errors.validation({
      exerciseIds: `No exercise answers to ${missing.join(', ')}. A template carries whole exercises to the app, so one it cannot find is one the phone drops.`,
    });
  }
  return ids;
}

/** What a template works, from the exercises in it — so the card never disagrees with its own contents. */
async function groupsOf(ids: string[]): Promise<string[]> {
  const rows = await ExerciseModel.find({ _id: { $in: ids } }, { muscleGroup: 1 }).lean();
  return [...new Set(rows.map(row => row.muscleGroup).filter((group): group is string => Boolean(group)))];
}

export async function createTemplate(actor: string, body: TemplateBody) {
  const id = body.id ?? slugify(body.title);
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(id)) {
    throw Errors.validation({ id: `“${body.title}” does not make an id — type one, like push-day.` });
  }
  if (await WorkoutTemplateModel.exists({ _id: id })) {
    throw Errors.validation({ id: `There is already a “${id}” template.` });
  }
  const ids = await assertExercises([...new Set(body.exerciseIds)]);

  await WorkoutTemplateModel.create({
    _id: id,
    title: body.title,
    description: body.description ?? '',
    estimatedMinutes: body.estimatedMinutes,
    muscleGroups: body.muscleGroups ?? (await groupsOf(ids)),
    exerciseIds: ids,
    sort: body.sort ?? 0,
  });
  await audit(actor, 'workout_template.created', 'workout_template', id, null, { ...body, id, note: body.note ?? null });
  return { created: true, ...(await listTraining()) };
}

export async function updateTemplate(actor: string, id: string, body: TemplatePatch) {
  const before = await WorkoutTemplateModel.findById(id).lean();
  if (!before) throw Errors.notFound('That template');
  const { note, ...fields } = body;
  if (Object.keys(fields).length === 0) throw Errors.validation({ title: 'Nothing to change.' });

  if (fields.exerciseIds !== undefined) {
    const ids = await assertExercises([...new Set(fields.exerciseIds)]);
    fields.exerciseIds = ids;
    // The card follows its contents unless the operator named the groups.
    if (fields.muscleGroups === undefined) fields.muscleGroups = (await groupsOf(ids)) as TemplatePatch['muscleGroups'];
  }

  await WorkoutTemplateModel.updateOne({ _id: id }, { $set: fields });
  await audit(actor, 'workout_template.updated', 'workout_template', id, { title: before.title, exerciseIds: before.exerciseIds ?? [] }, { ...fields, note: note ?? null });
  return listTraining();
}

/**
 * Deletes a template.
 *
 * Nothing points at one: a workout a member started from a template keeps
 * its own copy of the exercises and its own title, so the row can go.
 */
export async function deleteTemplate(actor: string, id: string, note?: string) {
  const before = await WorkoutTemplateModel.findById(id).lean();
  if (!before) throw Errors.notFound('That template');
  await WorkoutTemplateModel.deleteOne({ _id: id });
  await audit(actor, 'workout_template.deleted', 'workout_template', id, { title: before.title, exerciseIds: before.exerciseIds ?? [] }, { deleted: true, note: note ?? null });
  return { deleted: true, id, ...(await listTraining()) };
}
