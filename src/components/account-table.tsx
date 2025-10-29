import Frog1Image from '@/assets/images/frog-1.png';
import AccountRow from '@/components/account-row';
import { useAppStore } from '@/store';
import { faCircleInfo, faFileExport, faGear, faLock, faUser } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { FC } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';

const AccountTable: FC = () => {
    const { accounts } = useAppStore();
    const [isExporting, setIsExporting] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const [maxHeight, setMaxHeight] = useState<string>('auto');

    useLayoutEffect(() => {
        if (containerRef.current) {
            const initialHeight = containerRef.current.offsetHeight;
            if (maxHeight === 'auto') {
                setMaxHeight(`${initialHeight}px`);
            }
        }
    }, [containerRef.current]);

    const handleExport = async () => {
        if (isExporting) return;

        setIsExporting(true);
        try {
            const accountsToExport = accounts.filter((acc) => acc.message === 'done' && acc.username && acc.password).map((acc) => ({ username: acc.username, password: acc.password }));

            if (accountsToExport.length === 0) {
                await window.electron?.showMessageBox({
                    type: 'warning',
                    title: 'Cảnh báo',
                    message: 'Không có tài khoản nào để xuất!'
                });
                return;
            }

            const result = await window.electron?.saveAccounts(accountsToExport);
            if (result?.success) {
                await window.electron?.showMessageBox({
                    type: 'info',
                    title: 'Thành công',
                    message: `Đã xuất ${accountsToExport.length} tài khoản thành công!`
                });
            } else if (result?.error) {
                await window.electron?.showMessageBox({
                    type: 'error',
                    title: 'Lỗi',
                    message: `Lỗi khi xuất file: ${result.error}`
                });
            }
        } catch {
            await window.electron?.showMessageBox({
                type: 'error',
                title: 'Lỗi',
                message: 'Có lỗi xảy ra khi xuất file!'
            });
        } finally {
            setIsExporting(false);
        }
    };

    if (accounts.length === 0) {
        return (
            <div className='flex flex-1 items-center justify-center rounded-lg border border-emerald-200 bg-linear-to-br from-white to-emerald-50 shadow-sm'>
                <div className='flex flex-col items-center gap-4'>
                    <img src={Frog1Image} alt='empty' className='h-32 w-32' />
                    <p className='text-xl font-semibold text-emerald-500'>Ếch đang đợi bạn nhấn RUN</p>
                </div>
            </div>
        );
    }

    return (
        <div className='flex flex-1 flex-col overflow-hidden rounded-lg border border-emerald-200 bg-white shadow-sm'>
            <div className='flex items-center justify-between border-b border-emerald-200 bg-linear-to-r from-emerald-50 to-emerald-100 px-4 py-2'>
                <h3 className='text-sm font-semibold text-emerald-900'>Danh sách tài khoản ({accounts.length})</h3>
                <button onClick={handleExport} disabled={isExporting || accounts.length === 0} className='flex items-center gap-2 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50'>
                    <FontAwesomeIcon icon={faFileExport} className='h-3.5 w-3.5' />
                    {isExporting ? 'Đang xuất...' : 'Xuất file'}
                </button>
            </div>

            <div className='grid grid-cols-[3rem_15rem_15rem_1fr_0.2fr] gap-0 border-b border-emerald-200 bg-linear-to-r from-emerald-50 to-emerald-100'>
                <div className='px-4 py-3 text-left text-sm font-semibold text-emerald-900'>#</div>
                <div className='px-4 py-3 text-left text-sm font-semibold text-emerald-900'>
                    <div className='flex items-center gap-2'>
                        <FontAwesomeIcon icon={faUser} className='h-4 w-4 text-emerald-500' />
                        User
                    </div>
                </div>
                <div className='px-4 py-3 text-left text-sm font-semibold text-emerald-900'>
                    <div className='flex items-center gap-2'>
                        <FontAwesomeIcon icon={faLock} className='h-4 w-4 text-emerald-500' />
                        Pass
                    </div>
                </div>
                <div className='px-4 py-3 text-left text-sm font-semibold text-emerald-900'>
                    <div className='flex items-center gap-2'>
                        <FontAwesomeIcon icon={faCircleInfo} className='h-4 w-4 text-emerald-500' />
                        Trạng thái
                    </div>
                </div>
                <div className='px-4 py-3 text-center text-sm font-semibold text-emerald-900'>
                    <FontAwesomeIcon icon={faGear} className='h-4 w-4 text-emerald-500' />
                </div>
            </div>

            <div ref={containerRef} style={{ maxHeight: maxHeight }} className='flex-1 overflow-x-hidden overflow-y-auto'>
                <div className='grid grid-cols-[3rem_15rem_15rem_1fr_0.2fr] gap-0'>
                    {accounts.map((account, index) => (
                        <AccountRow key={account.id} account={account} index={index} />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default AccountTable;
