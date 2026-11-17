import { Context } from 'hydrooj';

export async function apply(ctx: Context) {
    ctx.i18n.load('zh', {
        ProbType: '题目类型',
        'Back to contest list': '比赛列表',
        'Contest Scoreboard': '排行榜',
        contest_scoreboard: '排行榜',
    });
}
