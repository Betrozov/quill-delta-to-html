
import { InsertOpsConverter } from './InsertOpsConverter';
import { OpToHtmlConverter, IOpToHtmlConverterOptions, IHtmlParts } from './OpToHtmlConverter';
import { DeltaInsertOp } from './DeltaInsertOp';
import { OpGroup } from './OpGroup';
import { makeStartTag, makeEndTag } from './funcs-html';
import { assign } from './funcs-misc';
import { NewLine } from './value-types';


interface IQuillDeltaToHtmlConverterOptions {
    orderedListTag?: string,
    bulletListTag?: string,
    paragraphTag?: string,
    makeParagraphPerLine?: boolean,
    classPrefix?: string,
    encodeHtml?: boolean
}

const BrTag = '<br/>';

class QuillDeltaToHtmlConverter {

    private options: IQuillDeltaToHtmlConverterOptions;
    private rawDeltaOps: any[] = [];
    private converter: OpToHtmlConverter;

    // render callbacks 
    private callbacks: any = {};

    constructor(
        deltaOps: any[],
        options?: IQuillDeltaToHtmlConverterOptions) {

        this.options = assign({
            orderedListTag: 'ol',
            bulletListTag: 'ul',
            paragraphTag: 'p',
            makeParagraphPerLine: true,
            encodeHtml: true,
            classPrefix: 'ql'
        }, options);

        this.converter = new OpToHtmlConverter({
            encodeHtml: this.options.encodeHtml,
            classPrefix: this.options.classPrefix
        });
        this.rawDeltaOps = deltaOps;

    }

    getListTag(op: DeltaInsertOp): string {
        return op.isOrderedList() ? this.options.orderedListTag + ''
            : op.isBulletList() ? this.options.bulletListTag + ''
                : '';
    }

    convert() {
        var deltaOps = InsertOpsConverter.convert(this.rawDeltaOps);

        // holds the list tags(ol, ul) that are opened and needs closing
        var tagStack: string[] = [];

        // holds html string being built
        var htmlArr: string[] = [];

        const beginListTag = (tag: string) => {
            tag && tagStack.push(tag) && htmlArr.push('<' + tag + '>');
        };

        const endListTag = (shouldEndAllTags: boolean = false) => {
            var endTag = () => {
                var tag = tagStack.pop();
                tag && htmlArr.push('</' + tag + '>');
            };
            shouldEndAllTags ? tagStack.map(endTag) : endTag();
        };

        const callCustomRenderCb = function (cbName: string, args: any) {
            cbName += '_cb';
            if (typeof this.callbacks[cbName] === 'function') {
                return this.callbacks[cbName].apply(null, args);
            }
            // return original html if this is an after call back, otherwise undef
            return cbName.indexOf('after') === 0 ? args[0] : undefined;
        }.bind(this);

        var groupedOps = OpGroup.groupOps(deltaOps);
        var len = groupedOps.length;
        var group, prevGroup, html, prevOp;
        const prevOpFn = (pg:OpGroup) => pg.op || pg.ops && pg.ops.length && pg.ops[pg.ops.length-1];
        for (var i = 0; i < len; i++) {
            group = groupedOps[i];
            prevGroup = i > 0 ? groupedOps[i - 1] : null;
            prevOp = prevGroup && prevOpFn(prevGroup); 
            if (this.shouldEndList(prevOp, group.op)) {
                endListTag();
            }

            if (group.op && group.op.isContainerBlock()) {
                if (this.shouldBeginList(prevOp, group.op)) {
                    beginListTag(this.getListTag(group.op));
                }
                html = callCustomRenderCb('beforeContainerBlockRender', [group.op, group.ops]);
                if (!html) {
                    html = this.renderContainerBlock(group.op, group.ops);
                    html = callCustomRenderCb('afterContainerBlockRender', [html]);
                }

                htmlArr.push(html);

            } else if (group.op && group.op.isDataBlock()) {
                html = callCustomRenderCb('beforeDataBlockRender', [group.op]);
                if (!html) {
                    html = this.converter.getHtml(group.op);
                    html = callCustomRenderCb('afterDataBlockRender', [html]);
                }

                htmlArr.push(html);

            } else if (!group.op && group.ops) {
                html = callCustomRenderCb('beforeInlineGroupRender', [group.ops]);
                if (!html) {
                    html = this.renderInlines(group.ops);
                    html = callCustomRenderCb('afterInlineGroupRender', [html]);
                }
                htmlArr.push(html);
            }
        }
        // close any open list; 
        endListTag(true);
        return htmlArr.join('');
    }

    renderContainerBlock(op: DeltaInsertOp, ops: DeltaInsertOp[]) {

        var htmlParts = this.converter.getHtmlParts(op);
        
        if (op.isCodeBlock()) {
            return htmlParts.openingTag + 
                ops.map((op) => op.insert.value ).join(NewLine)
             + htmlParts.closingTag;
        }

        var inlines = this.renderInlines(ops, true);
        return htmlParts.openingTag + (inlines || BrTag) + htmlParts.closingTag;
    }

    renderInlines(ops: DeltaInsertOp[], renderingWithinBlock: boolean = false): string {

        var nlRx = /\n/g;
        var pStart: string, pEnd: string; 
        var pStartOuter = pStart = makeStartTag(this.options.paragraphTag);
        var pEndOuter = pEnd = makeEndTag(this.options.paragraphTag);

        if (!this.options.makeParagraphPerLine || renderingWithinBlock) {
            pStart = '';
            pEnd = '';
        }

        if (renderingWithinBlock) {
            pStartOuter = ''; 
            pEndOuter = '';
        }

        // styled when first line, last line, nl before
        var lastIndex = ops.length - 1;
        var replaced_html, html, isPrevNl: boolean, isNextNl: boolean;
        return ops.reduce(function(result: string[], op: DeltaInsertOp, i: number){

            html = this.converter.getHtml(op);

            if (!op.isJustNewline()) {
                result.push(html);
                return result;
            } 

            replaced_html = html.replace(nlRx, BrTag);

            if (0 === lastIndex) {
                result.push(replaced_html);
                return result;
            }
        
            var endStart = pEnd + pStart;

            if (i === 0) {
                result.push( replaced_html + endStart);
            } else if ( i < lastIndex) {
                isPrevNl = ops[i - 1].isJustNewline(); 
                isNextNl = ops[i + 1].isJustNewline();
                if (!isPrevNl && !isNextNl) {
                    result.push( endStart || BrTag);
                } else if (isNextNl) {
                    result.push(endStart + replaced_html );
                } else if (isPrevNl) {
                    result.push(endStart || BrTag)
                }
            }
           
            return result;
        }.bind(this), [pStartOuter]).concat(pEndOuter).join('');
        
    }

    shouldBeginList(prevOp: DeltaInsertOp, currOp: DeltaInsertOp) {
        if(!currOp) {
            return false;
        }
        // if previous one is not list but current one is, then yes
        if ((!prevOp || !prevOp.isList()) && currOp.isList()) {
            return true;
        }

        // if current and previou ones are lists that are diff
        if (prevOp && prevOp.isList() && currOp.isList() && !prevOp.isSameListAs(currOp)) {
            return true;
        }
        return false;
    }

    shouldEndList(prevOp: DeltaInsertOp, currOp: DeltaInsertOp) {

        // if previous one is a list but current one is not, then yes
        if (prevOp && prevOp.isList() && (!currOp || !currOp.isList())) {
            return true;
        }

        // if current and previou ones are lists that are not same 
        if (prevOp && prevOp.isList() && currOp && currOp.isList() && !prevOp.isSameListAs(currOp)) {
            return true;
        }
        return false;
    }

    beforeContainerBlockRender(cb: (op: DeltaInsertOp, ops: DeltaInsertOp[]) => string) {
        if (typeof cb === 'function') {
            this.callbacks['beforeContainerBlockRender_cb'] = cb;
        }
    }
    beforeDataBlockRender(cb: (op: DeltaInsertOp) => string) {
        if (typeof cb === 'function') {
            this.callbacks['beforeDataBlockRender_cb'] = cb;
        }
    }
    beforeInlineGroupRender(cb: (ops: DeltaInsertOp[]) => string) {
        if (typeof cb === 'function') {
            this.callbacks['beforeInlineGroupRender_cb'] = cb;
        }
    }
    afterContainerBlockRender(cb: (html: string) => string) {
        if (typeof cb === 'function') {
            this.callbacks['afterContainerBlockRender_cb'] = cb;
        }
    }
    afterDataBlockRender(cb: (html: string) => string) {
        if (typeof cb === 'function') {
            this.callbacks['afterDataBlockRender_cb'] = cb;
        }
    }
    afterInlineGroupRender(cb: (html: string) => string) {
        if (typeof cb === 'function') {
            this.callbacks['afterInlineGroupRender_cb'] = cb;
        }
    }

}

export default QuillDeltaToHtmlConverter;
